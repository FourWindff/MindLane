/**
 * Message preparation: the single answer to "what happens to the message array before a
 * model call" — the fixed step order and all four step implementations live here.
 * Step functions are exported for tests and reuse, but callers must not compose them
 * individually: the order *is* the semantics — use prepareMessagesForModel.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { AGENT_LIMITS } from '../config.js'
import { estimateMessageTokens } from '../lib/tokenCounter.js'
import { messageContentToString, sanitizeAIMessageContent, sanitizeFileName } from '../utils.js'
import { logger } from '../../shared/logger.js'

const log = logger.withContext('messagePreparation')

/**
 * Message preparation configuration
 *
 * Used to normalize and compress state.messages before mindlaneAgent calls the LLM.
 */
export interface MessagePreparationConfig {
  /**
   * **Total input** token budget allowed for a single model call (including the system prompt
   * and the current user message).
   * Derived from the model context window: window − output reserve − estimation-error buffer.
   */
  inputBudgetTokens: number
  /** Max bytes for a single tool_result; larger results are offloaded to disk */
  toolResultMaxBytes: number
}

/** Default max bytes for a single tool_result before it is offloaded to disk. */
export const DEFAULT_TOOL_RESULT_MAX_BYTES = 8_000

/**
 * Production config: the input budget is derived from the model context window.
 * The output reserve and the estimation buffer are fixed deductions (not scaled
 * with the window); both live in AGENT_LIMITS.
 */
export function messagePreparationConfig(contextWindow: number): MessagePreparationConfig {
  return {
    inputBudgetTokens:
      contextWindow - AGENT_LIMITS.maxCompletionTokens - AGENT_LIMITS.consolidationSafetyBuffer,
    toolResultMaxBytes: DEFAULT_TOOL_RESULT_MAX_BYTES,
  }
}

/**
 * Prepare the message array by composing 6 steps in a fixed order (4
 * implementations, with the pairing repair run before and after):
 * 1. drop orphan tool_results (dropOrphanToolResults)
 * 2. backfill missing tool_results (backfillMissingToolResults)
 * 3. apply tool_result budget (applyToolResultBudget)
 * 4. snip history (snipHistory)
 * 5. drop orphan tool_results (dropOrphanToolResults)
 * 6. backfill missing tool_results (backfillMissingToolResults)
 *
 * Returns a new processed array; the original array is not modified and nothing is written to the session.
 */
export async function prepareMessagesForModel(
  messages: BaseMessage[],
  config: MessagePreparationConfig,
  userDataPath?: string,
): Promise<BaseMessage[]> {
  const validMessages = messages
    .filter((m, i): m is BaseMessage => {
      const isValid = Boolean(
        m &&
        typeof m === 'object' &&
        'type' in m &&
        typeof (m as { getType?: unknown }).getType === 'function',
      )
      if (!isValid) {
        log.warn('dropping invalid input message at %d: %o', i, m)
      }
      return isValid
    })
    .map((m) => {
      if (m.type !== 'ai') return m
      const aiMsg = m as AIMessage
      const sanitizedContent = sanitizeAIMessageContent(aiMsg.content)
      if (sanitizedContent === aiMsg.content) return m
      return new AIMessage({
        id: aiMsg.id,
        content: sanitizedContent as AIMessage['content'],
        tool_calls: aiMsg.tool_calls,
        invalid_tool_calls: aiMsg.invalid_tool_calls,
        additional_kwargs: aiMsg.additional_kwargs,
        response_metadata: aiMsg.response_metadata,
        usage_metadata: aiMsg.usage_metadata,
      })
    })

  let result = dropOrphanToolResults(validMessages)
  result = backfillMissingToolResults(result)
  result = await applyToolResultBudget(result, config, userDataPath)
  result = snipHistory(result, config)
  result = dropOrphanToolResults(result)
  result = backfillMissingToolResults(result)

  for (let i = 0; i < result.length; i++) {
    const m = result[i]
    if (!m || typeof m !== 'object' || !('type' in m)) {
      log.warn('invalid output message at %d: %o', i, m)
    }
  }

  return result
}

/**
 * Drop orphan tool_result messages that have no matching tool_use
 */
export function dropOrphanToolResults(messages: BaseMessage[]): BaseMessage[] {
  const toolCallIds = new Set<string>()

  for (const msg of messages) {
    if (msg.type === 'ai') {
      const aiMsg = msg as AIMessage
      for (const tc of aiMsg.tool_calls ?? []) {
        if (tc.id) {
          toolCallIds.add(tc.id)
        }
      }
    }
  }

  const kept = messages.filter((msg) => {
    if (msg.type !== 'tool') return true
    const toolMsg = msg as ToolMessage
    return toolCallIds.has(toolMsg.tool_call_id)
  })

  const dropped = messages.length - kept.length
  if (dropped > 0) {
    // Orphan tool_result means upstream lost the matching tool_use — log as warn.
    log.warn('pairing: dropped %d orphan tool_result messages', dropped)
  }

  return kept
}

const MISSING_TOOL_RESULT_PLACEHOLDER = '[Tool result unavailable — call was interrupted or lost]'

/**
 * Insert placeholder results for tool_use calls that have no matching tool_result.
 * The placeholder message follows its AI tool_use message, preserving the original order.
 */
export function backfillMissingToolResults(messages: BaseMessage[]): BaseMessage[] {
  const existingResultIds = new Set<string>()
  for (const msg of messages) {
    if (msg.type === 'tool') {
      existingResultIds.add((msg as ToolMessage).tool_call_id)
    }
  }

  const result: BaseMessage[] = []
  let backfilled = 0
  for (const msg of messages) {
    result.push(msg)

    if (msg.type !== 'ai') continue
    const aiMsg = msg as AIMessage
    for (const tc of aiMsg.tool_calls ?? []) {
      if (tc.id && !existingResultIds.has(tc.id)) {
        result.push(
          new ToolMessage({
            tool_call_id: tc.id,
            name: tc.name,
            content: MISSING_TOOL_RESULT_PLACEHOLDER,
          }),
        )
        existingResultIds.add(tc.id)
        backfilled += 1
      }
    }
  }

  if (backfilled > 0) {
    // A missing tool_result means upstream dropped or interrupted a tool call — log as warn.
    log.warn('pairing: backfilled placeholder tool_result for %d tool_use calls', backfilled)
  }

  return result
}

function getToolName(msg: ToolMessage): string {
  return msg.name ?? 'unknown'
}

/**
 * Limit the size of a single tool_result: oversized content is written to a temp file under
 * userData and the original message is replaced with a reference.
 */
export async function applyToolResultBudget(
  messages: BaseMessage[],
  config: MessagePreparationConfig,
  userDataPath?: string,
): Promise<BaseMessage[]> {
  if (config.toolResultMaxBytes <= 0) return messages

  const result: BaseMessage[] = []
  for (const msg of messages) {
    if (msg.type !== 'tool') {
      result.push(msg)
      continue
    }

    const toolMsg = msg as ToolMessage
    const text = messageContentToString(toolMsg.content)
    const buffer = Buffer.from(text, 'utf8')

    if (buffer.length <= config.toolResultMaxBytes) {
      result.push(msg)
      continue
    }

    const refContent = await createOffloadReference(
      toolMsg,
      text,
      config.toolResultMaxBytes,
      userDataPath,
    )

    result.push(
      new ToolMessage({
        tool_call_id: toolMsg.tool_call_id,
        name: toolMsg.name,
        content: refContent,
        additional_kwargs: toolMsg.additional_kwargs,
      }),
    )
  }

  return result
}

async function createOffloadReference(
  toolMsg: ToolMessage,
  text: string,
  budget: number,
  userDataPath?: string,
): Promise<string> {
  const toolName = getToolName(toolMsg)
  const safeToolName = sanitizeFileName(toolName)
  const safeCallId = sanitizeFileName(toolMsg.tool_call_id)

  const headChars = Math.max(0, budget - 256)
  const head = text.slice(0, headChars)
  const totalBytes = Buffer.byteLength(text, 'utf8')

  let filePath: string | undefined
  if (userDataPath) {
    const dir = path.join(userDataPath, 'message-pipeline-offloads')
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    filePath = path.join(dir, `${safeCallId}-${safeToolName}.txt`)
    await fs.writeFile(filePath, text, 'utf8').catch(() => {
      filePath = undefined
    })
  }

  const refLine = filePath
    ? `Full content offloaded to: ${filePath}`
    : 'Offload to disk failed; content truncated.'

  return `[Tool result exceeded ${budget} bytes budget (${totalBytes} bytes total).]\n${refLine}\n\nFirst ${headChars} characters:\n${head}`
}

/**
 * Truncate history messages by token budget.
 * System messages, the last user message, and the most recent turns are kept preferentially.
 * After truncation, tool_use / tool_result pairing is re-validated and repaired.
 */
export function snipHistory(
  messages: BaseMessage[],
  config: MessagePreparationConfig,
): BaseMessage[] {
  if (config.inputBudgetTokens <= 0) return messages

  const systemMsgs = messages.filter((m) => m.type === 'system')
  const nonSystem = messages.filter((m) => m.type !== 'system')

  const lastNonSystem = nonSystem[nonSystem.length - 1]
  const currentUserMsg = lastNonSystem?.type === 'human' ? lastNonSystem : null

  const history = currentUserMsg ? nonSystem.slice(0, -1) : nonSystem

  const keptHistory = trimHistoryToBudget(
    history,
    config.inputBudgetTokens -
      estimateMessageTokens(systemMsgs) -
      (currentUserMsg ? estimateMessageTokens([currentUserMsg]) : 0),
  )

  const result: BaseMessage[] = [...systemMsgs, ...keptHistory]

  if (currentUserMsg) {
    result.push(currentUserMsg)
  }

  return backfillMissingToolResults(dropOrphanToolResults(result))
}

function trimHistoryToBudget(messages: BaseMessage[], budget: number): BaseMessage[] {
  if (budget <= 0) return []

  let total = estimateMessageTokens(messages)
  if (total <= budget) return messages

  // Drop older messages from the head first, keeping the most recent turns
  let start = 0
  while (start < messages.length && total > budget) {
    total -= estimateMessageTokens([messages[start]])
    start++
  }

  if (start > 0) {
    // Dropped history can hide upstream message-construction bugs — keep it visible.
    log.warn(
      'snip: dropped %d/%d history messages (budget %d tokens)',
      start,
      messages.length,
      budget,
    )
  }

  return messages.slice(start)
}
