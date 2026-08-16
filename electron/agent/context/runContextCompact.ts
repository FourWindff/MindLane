import { SystemMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'
import { Consolidator } from './consolidator.js'
import { buildSystemPrompt, loadMemoryContext } from '../agenthub/mindlane/context.js'
import { createExtractionCallback } from '../memory/memoryExtractor.js'
import { AGENT_LIMITS } from '../config.js'
import { logger } from '../../shared/logger.js'
import type { LLMProvider } from '../providers/index.js'
import type { AgentServices } from '../service.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { MainGraphStateType } from '../state.js'

/**
 * 单次运行装配：把 run 级上下文（记忆预载、system prompt 构建、记忆提取回调、
 * Consolidator）收进一个具名模块。图节点只需一行
 * `runContextCompact(runAssemblyDeps, state, config)`。
 *
 * 每次运行新建 Consolidator：`buildMessages` / `onArchived` 依赖 run 级的
 * `state.context`，无法在 graph 构建期固定。
 */
export interface RunContextAssemblyDeps {
  provider: LLMProvider
  services: AgentServices
  hasPalace: boolean
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
  const { provider, services, hasPalace, toolRegistry } = deps
  const sessionManager = services.sessionManager
  const threadId = config?.configurable?.thread_id ?? ''

  // 预载记忆一次，供预算估算的每次 buildMessages 复用（避免每轮重复读盘）；
  // supervisor 的真实调用仍现读现用（记忆提取可能在 run 中途写入新证据）。
  const memory = await loadMemoryContext(state.context ?? undefined, services.memoryManager)

  const buildMessages = async (
    messages: BaseMessage[],
    lastSummary?: string,
  ): Promise<BaseMessage[]> => {
    const systemPrompt = await buildSystemPrompt({
      context: state.context ?? undefined,
      capabilityFlags: { hasPalace },
      lastSummary,
      memory,
    })

    return [new SystemMessage(systemPrompt), ...messages]
  }

  const getToolDefinitions = () => toolRegistry.allTools

  // Memory extraction hooks into compression: the archived slice plus
  // the file's editlog are the extraction input (fire-and-forget).
  // 装配后必全：memoryExtractor / editLogStore 非可选，仅凭 fileUuid 判断是否触发。
  const fileUuid = state.context?.fileUuid
  const onArchived = fileUuid
    ? createExtractionCallback({
        extractor: services.memoryExtractor,
        editLogStore: services.editLogStore,
        provider,
        workspaceUuid: sessionManager.workspaceUuid,
        fileUuid,
        filePath: state.context?.filePath,
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
      safetyBuffer: AGENT_LIMITS.consolidationSafetyBuffer,
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
      budget:
        AGENT_LIMITS.contextWindowTokens -
        AGENT_LIMITS.maxCompletionTokens -
        AGENT_LIMITS.consolidationSafetyBuffer,
    })

    const meta = sessionManager.getSessionMeta(threadId)

    return {
      summary: meta?._lastSummary ?? '',
      messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...contextMessages],
    }
  } catch (err) {
    // I/O 级故障（LLM 失败已在 Consolidator 内部吞掉并自愈）：
    // 跳过本次压缩，消息原样交给 supervisor；超预算由 supervisor 的
    // 非 LLM 裁剪重试兜底。
    logger
      .withContext('compact')
      .warn('Consolidator failed for session %s, skipping compaction:', threadId, err)
    return {}
  }
}
