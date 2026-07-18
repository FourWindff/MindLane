/**
 * Model-call metering: a LangChain callback handler attached to every
 * BaseChatModel logs one info line per call (model, elapsed, tokens in/out).
 * When a provider omits usage, the field is logged as `?` — the line is
 * never skipped. The streamId is auto-attached by the logger from
 * AsyncLocalStorage (see shared/runContext).
 *
 * It also counts model calls per streamId so graph summaries can report
 * "模型调用 N 次" without instrumenting every invoke site.
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { LLMResult } from '@langchain/core/outputs'
import type { Serialized } from '@langchain/core/load/serializable'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { logger } from '../../shared/logger.js'
import { currentStreamId } from '../../shared/runContext.js'

const log = logger.withContext('llm')

interface Usage {
  input?: number
  output?: number
}

/** Normalized usage_metadata first (LC 1.x), then provider-specific llmOutput shapes. */
function extractUsage(result: LLMResult): Usage {
  const generation = result.generations?.[0]?.[0] as
    { message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } } | undefined
  const message = generation?.message
  if (message?.usage_metadata) {
    return {
      input: message.usage_metadata.input_tokens,
      output: message.usage_metadata.output_tokens,
    }
  }

  const llmOutput = result.llmOutput as
    | {
        tokenUsage?: { promptTokens?: number; completionTokens?: number }
        usage?: { input_tokens?: number; output_tokens?: number }
      }
    | undefined
  if (llmOutput?.tokenUsage) {
    return {
      input: llmOutput.tokenUsage.promptTokens,
      output: llmOutput.tokenUsage.completionTokens,
    }
  }
  if (llmOutput?.usage) {
    return { input: llmOutput.usage.input_tokens, output: llmOutput.usage.output_tokens }
  }
  return {}
}

function extractModelName(llm: Serialized): string {
  const kwargs = (llm as { kwargs?: Record<string, unknown> }).kwargs
  const model = kwargs?.model ?? kwargs?.model_name ?? kwargs?.modelName
  return typeof model === 'string' ? model : 'unknown-model'
}

class MeteringHandler extends BaseCallbackHandler {
  name = 'metering'
  private readonly starts = new Map<string, { start: number; model: string; node?: string }>()

  /** LangGraph puts `langgraph_node` in run metadata — that tells us WHO is calling the model. */
  private recordStart(llm: Serialized, runId: string, metadata?: Record<string, unknown>): void {
    const node = typeof metadata?.langgraph_node === 'string' ? metadata.langgraph_node : undefined
    this.starts.set(runId, { start: Date.now(), model: extractModelName(llm), node })
  }

  override handleChatModelStart(
    llm: Serialized,
    _messages: unknown,
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    this.recordStart(llm, runId, metadata)
  }

  override handleLLMStart(
    llm: Serialized,
    _prompts: string[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    this.recordStart(llm, runId, metadata)
  }

  override handleLLMEnd(output: LLMResult, runId: string): void {
    const record = this.starts.get(runId)
    if (!record) return
    this.starts.delete(runId)

    const usage = extractUsage(output)
    const elapsed = (Date.now() - record.start) / 1000
    // Node-tagged context (llm:supervisor / llm:leaf_extract / …) distinguishes
    // supervisor calls from subgraph calls; falls back to plain `llm`.
    const line = record.node ? logger.withContext(`llm:${record.node}`) : log
    line.info(
      '%s 完成，耗时 %ss，tokens in=%s out=%s',
      record.model,
      elapsed.toFixed(1),
      usage.input ?? '?',
      usage.output ?? '?',
    )

    const streamId = currentStreamId()
    if (streamId) callCounts.set(streamId, (callCounts.get(streamId) ?? 0) + 1)
  }

  override handleLLMError(_err: unknown, runId: string): void {
    // Failures are reported by the retry / agent layers; just drop the timer.
    this.starts.delete(runId)
  }
}

const callCounts = new Map<string, number>()

/** Model calls so far in the given stream (graph summaries read this at run end). */
export function takeModelCallCount(streamId: string): number {
  const count = callCounts.get(streamId) ?? 0
  callCounts.delete(streamId)
  return count
}

const meteringHandler = new MeteringHandler()

/** Attach the shared metering handler to a chat model (idempotent per model). */
export function attachMetering(model: BaseChatModel): void {
  const existing = Array.isArray(model.callbacks) ? model.callbacks : []
  if (existing.some((cb) => cb instanceof MeteringHandler)) return
  model.callbacks = [...existing, meteringHandler]
}
