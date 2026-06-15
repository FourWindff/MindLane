import {
  RemoveMessage,
  type BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { AGENT_LIMITS } from '../config.js'
import { estimateTokenCount, estimateMessageTokens } from '../lib/tokenCounter.js'
import { ContextBuilder } from '../agenthub/mindlane/context.js'
import type { CapabilityFlags } from '../agenthub/mindlane/mindlaneAgent.js'
import type { MainGraphStateType } from '../state.js'
import type { LLMProvider } from '../providers/index.js'
import type { MemoryManager } from './memoryManager.js'
import { extractTextContent } from '../utils.js'
import { logger } from '../../shared/logger.js'

/**
 * 检测错误是否为 prompt-too-long / 上下文超限类错误
 */
export function isPromptTooLongError(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return (
    message.includes('prompt_too_long') ||
    message.includes('too many tokens') ||
    message.includes('413') ||
    message.includes('context length') ||
    message.includes('maximum context length') ||
    message.includes('token limit')
  )
}

/**
 * 估算工具 schema 的 token 数
 */
export function estimateToolsSchemaTokens(tools: StructuredToolInterface[]): number {
  let total = 0
  for (const tool of tools) {
    const toolAny = tool as unknown as Record<string, unknown>
    const schema = toolAny.schema || (tool as unknown as { lc_kwargs?: { schema?: unknown } }).lc_kwargs?.schema
    if (schema) {
      total += estimateTokenCount(JSON.stringify(schema))
    }
  }
  return total
}

/**
 * 估算 system prompt 的 token 数
 */
async function estimateSystemPromptTokens(
  state: MainGraphStateType,
  memoryManager?: MemoryManager,
  capabilityFlags?: CapabilityFlags,
): Promise<number> {
  const builder = new ContextBuilder()
    .withMessages(state.messages)
    .withContext(state.context ?? undefined)
    .withCapabilityFlags(capabilityFlags)
    .withMemory(memoryManager)

  await builder.buildMemoryContext()
  builder.buildSystemPrompt()
    .buildEnvironmentPrompt()
    .buildMindmapContext()
    .buildHistory()

  return estimateTokenCount(builder.build())
}

/**
 * 估算 supervisor 调用前的完整输入 token 数
 */
export async function estimateFullInputTokens(
  state: MainGraphStateType,
  tools: StructuredToolInterface[],
  _provider: LLMProvider,
  memoryManager?: MemoryManager,
  capabilityFlags?: CapabilityFlags,
): Promise<number> {
  const systemTokens = await estimateSystemPromptTokens(state, memoryManager, capabilityFlags)
  const toolsTokens = estimateToolsSchemaTokens(tools)
  const messagesTokens = estimateMessageTokens(state.messages)

  return systemTokens + toolsTokens + messagesTokens
}

/**
 * 裁剪到最近消息窗口，保留 system 消息和当前用户消息
 */
export function trimToRecentWindow(
  messages: BaseMessage[],
  recentCount: number,
): BaseMessage[] {
  const systemMsgs = messages.filter((m) => m.type === 'system')
  const nonSystem = messages.filter((m) => m.type !== 'system')

  const currentUserMsg =
    nonSystem.length > 0 && nonSystem[nonSystem.length - 1].type === 'human'
      ? nonSystem[nonSystem.length - 1]
      : null

  const history = currentUserMsg ? nonSystem.slice(0, -1) : nonSystem
  const recent = history.slice(-recentCount)

  return [...systemMsgs, ...recent, ...(currentUserMsg ? [currentUserMsg] : [])]
}

/**
 * 使用 LLM 生成对话摘要
 */
async function generateSummary(
  messages: BaseMessage[],
  model: BaseChatModel,
): Promise<string> {
  const summaryPrompt = new SystemMessage(
    '请用中文简要总结以下对话的关键信息。保留：1）用户的主要目标，2）关键事实和约束，3）最近待继续执行的任务，4）重要文件、节点或工具结果的高层结论。保持简短具体。',
  )

  const response = await model.invoke([
    summaryPrompt,
    ...messages,
    new HumanMessage('请总结以上对话。'),
  ])

  return extractTextContent(response.content)
}

/**
 * 主动压缩上下文节点
 *
 * 1. 估算完整输入 token 数
 * 2. 如果低于预算，返回空更新
 * 3. 如果超过预算，先轻量裁剪
 * 4. 裁剪后仍超预算，调用 LLM 生成摘要
 * 5. 返回 RemoveMessage(REMOVE_ALL_MESSAGES) + 压缩后的消息
 */
export async function compactContext(
  state: MainGraphStateType,
  tools: StructuredToolInterface[],
  provider: LLMProvider,
  memoryManager?: MemoryManager,
  capabilityFlags?: CapabilityFlags,
): Promise<Partial<MainGraphStateType>> {
  const inputBudget =
    AGENT_LIMITS.contextWindowTokens -
    AGENT_LIMITS.maxCompletionTokens -
    AGENT_LIMITS.contextSafetyBufferTokens

  const estimatedTokens = await estimateFullInputTokens(
    state,
    tools,
    provider,
    memoryManager,
    capabilityFlags,
  )

  if (estimatedTokens <= inputBudget) {
    return { messages: [] }
  }

  logger.info(
    '[contextCompact] Input over budget: %d > %d, trimming...',
    estimatedTokens,
    inputBudget,
  )

  // Step 1: 轻量裁剪 — 保留最近窗口
  let compacted = trimToRecentWindow(
    state.messages,
    AGENT_LIMITS.contextCompactRecentMessages,
  )

  const compactedEstimate = await estimateFullInputTokens(
    { ...state, messages: compacted },
    tools,
    provider,
    memoryManager,
    capabilityFlags,
  )

  if (compactedEstimate <= inputBudget) {
    logger.info(
      '[contextCompact] Trimmed to %d messages, estimate: %d',
      compacted.length,
      compactedEstimate,
    )
    return {
      messages: [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...compacted,
      ],
    }
  }

  // Step 2: LLM 摘要
  logger.info('[contextCompact] Trim insufficient, generating summary...')

  try {
    const summary = await generateSummary(state.messages, provider.reasoningModel)
    const summaryMsg = new AIMessage({ content: `[对话摘要] ${summary}` })

    const recentMessages = trimToRecentWindow(
      state.messages,
      AGENT_LIMITS.contextCompactRecentMessages,
    )

    compacted = [summaryMsg, ...recentMessages]

    const finalEstimate = await estimateFullInputTokens(
      { ...state, messages: compacted },
      tools,
      provider,
      memoryManager,
      capabilityFlags,
    )

    logger.info(
      '[contextCompact] Summary compacted to %d messages, estimate: %d',
      compacted.length,
      finalEstimate,
    )

    return {
      messages: [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...compacted,
      ],
    }
  } catch (err) {
    logger.warn('[contextCompact] LLM summary failed, falling back to smaller trim:', err)

    // 退化：保留更小的窗口
    compacted = trimToRecentWindow(
      state.messages,
      Math.max(1, Math.floor(AGENT_LIMITS.contextCompactRecentMessages / 2)),
    )

    return {
      messages: [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...compacted,
      ],
    }
  }
}
