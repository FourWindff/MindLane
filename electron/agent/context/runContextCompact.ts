import { SystemMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'
import { Consolidator } from './consolidator.js'
import { buildSystemPrompt, loadMemoryContext } from '../agenthub/mindlane/context.js'
import { createExtractionCallback } from '../memory/memoryExtractor.js'
import { AGENT_LIMITS } from '../config.js'
import { logger } from '../../shared/logger.js'
import { requireWorkspaceUuid } from '../../shared/runContext.js'
import type { LLMProvider } from '../providers/index.js'
import type { AgentServices } from '../service.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { MainGraphStateType } from '../state.js'

/**
 * Per-run assembly: collects the run-level context (memory preload, system
 * prompt construction, memory-extraction callback, Consolidator) into one named
 * module. A graph node only needs one line:
 * `runContextCompact(runAssemblyDeps, state, config)`.
 *
 * A new Consolidator is created for every run: `buildMessages` / `onArchived`
 * depend on the run-level `state.context`, which cannot be fixed at graph
 * construction time.
 */
export interface RunContextAssemblyDeps {
  provider: LLMProvider
  services: AgentServices
  userDataPath?: string
  toolRegistry: ToolRegistry
}

export interface RunContextCompactConfig {
  configurable?: { thread_id?: string }
}

export async function runContextCompact(
  deps: RunContextAssemblyDeps,
  state: MainGraphStateType,
  config?: RunContextCompactConfig,
): Promise<Partial<MainGraphStateType>> {
  const { provider, services, toolRegistry } = deps
  const sessionManager = services.sessionManager
  const threadId = config?.configurable?.thread_id ?? ''

  // Preload memory once so every budget-estimation buildMessages call can reuse it (avoiding a
  // disk read per round); the real supervisor call still reads it fresh (memory extraction may
  // write new evidence mid-run).
  const memory = await loadMemoryContext(services.memoryManager)

  const buildMessages = async (
    messages: BaseMessage[],
    lastSummary?: string,
  ): Promise<BaseMessage[]> => {
    const systemPrompt = await buildSystemPrompt({
      context: state.context ?? undefined,
      lastSummary,
      memory,
    })

    return [new SystemMessage(systemPrompt), ...messages]
  }

  const getToolDefinitions = () => toolRegistry.allTools

  // Memory extraction hooks into compression: the archived slice plus
  // the file's editlog are the extraction input (fire-and-forget).
  // Complete after assembly: memoryExtractor / editLogStore are non-optional; only fileUuid
  // decides whether extraction fires.
  const fileUuid = state.context?.fileUuid
  const onArchived = fileUuid
    ? createExtractionCallback({
        extractor: services.memoryExtractor,
        editLogStore: services.editLogStore,
        provider,
        workspaceUuid: requireWorkspaceUuid('memory extraction'),
        fileUuid,
      })
    : undefined

  const consolidator = new Consolidator(
    {
      sessionManager,
      provider,
      buildMessages,
      getToolDefinitions,
      onArchived,
    },
    {
      consolidationRatio: AGENT_LIMITS.consolidationRatio,
      maxContextMessages: AGENT_LIMITS.maxContextMessages,
      maxMessagesBeforeTokenCheck: AGENT_LIMITS.maxMessagesBeforeTokenCheck,
      maxConsolidationRounds: AGENT_LIMITS.maxConsolidationRounds,
    },
  )

  try {
    await consolidator.maybe_consolidate_by_tokens(threadId)
    const contextMessages = await consolidator.getMessagesForContext(threadId, {
      maxMessages: AGENT_LIMITS.maxContextMessages,
    })

    const meta = sessionManager.getSessionMeta(threadId)

    return {
      summary: meta?._lastSummary ?? '',
      messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...contextMessages],
    }
  } catch (err) {
    // I/O-level failure (LLM failures are already swallowed and self-healed inside
    // Consolidator): skip this compaction and hand the messages to the supervisor as-is;
    // over-budget calls fall back to the supervisor's non-LLM trimming retry.
    logger
      .withContext('compact')
      .warn('Consolidator failed for session %s, skipping compaction:', threadId, err)
    return {}
  }
}
