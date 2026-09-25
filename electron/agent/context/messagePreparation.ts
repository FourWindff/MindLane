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
 * 消息准备配置
 *
 * 用于在 mindlaneAgent 调用 LLM 前对 state.messages 进行规范化与压缩。
 */
export interface MessagePreparationConfig {
  /** 是否启用预处理管道 */
  enabled: boolean
  /**
   * 单次模型调用允许的**总输入** token 预算（含 system prompt 与当前用户消息）。
   * 由模型上下文窗口推导：窗口 − 输出预留 − 估算误差缓冲。
   */
  inputBudgetTokens: number
  /** 单条 tool_result 最大字节数，超过则转存磁盘 */
  toolResultMaxBytes: number
  /** snip 时是否始终保留 system 消息 */
  snipPreserveSystem: boolean
  /** snip 时是否始终保留最后一条 user 消息 */
  snipPreserveLastUser: boolean
}

const DEFAULT_MESSAGE_PREPARATION_CONFIG: Omit<MessagePreparationConfig, 'inputBudgetTokens'> = {
  enabled: true,
  toolResultMaxBytes: 8_000,
  snipPreserveSystem: true,
  snipPreserveLastUser: true,
}

/**
 * 合并部分配置到默认配置。
 *
 * 未显式给出输入预算时，从模型上下文窗口现算：输出预留与估算缓冲都是固定
 * 扣减项（不随窗口缩放），扣减值住 AGENT_LIMITS。
 */
export function mergeMessagePreparationConfig(
  partial: Partial<MessagePreparationConfig> | undefined,
  contextWindow: number,
): MessagePreparationConfig {
  return {
    ...DEFAULT_MESSAGE_PREPARATION_CONFIG,
    ...partial,
    inputBudgetTokens:
      partial?.inputBudgetTokens ??
      contextWindow - AGENT_LIMITS.maxCompletionTokens - AGENT_LIMITS.consolidationSafetyBuffer,
  }
}

/**
 * 预处理消息数组，按固定顺序组合 6 步调用（4 个实现，配对修复前后各跑一次）：
 * 1. drop orphan tool_results (dropOrphanToolResults)
 * 2. backfill missing tool_results (backfillMissingToolResults)
 * 3. apply tool_result budget (applyToolResultBudget)
 * 4. snip history (snipHistory)
 * 5. drop orphan tool_results (dropOrphanToolResults)
 * 6. backfill missing tool_results (backfillMissingToolResults)
 *
 * 返回处理后的新数组；不修改原始数组，也不写入 session。
 */
export async function prepareMessagesForModel(
  messages: BaseMessage[],
  config: MessagePreparationConfig,
  userDataPath?: string,
): Promise<BaseMessage[]> {
  if (!config.enabled) return messages

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
 * 删除没有对应 tool_use 的孤儿 tool_result 消息
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
    log.warn('pairing: 丢弃 %d 条孤儿 tool_result', dropped)
  }

  return kept
}

const MISSING_TOOL_RESULT_PLACEHOLDER = '[Tool result unavailable — call was interrupted or lost]'

/**
 * 为没有对应 tool_result 的 tool_use 插入占位结果。
 * 占位消息紧跟在对应的 AI tool_use 消息之后，保持原有顺序。
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
    log.warn('pairing: 为 %d 个 tool_use 补占位 tool_result', backfilled)
  }

  return result
}

function getToolName(msg: ToolMessage): string {
  return msg.name ?? 'unknown'
}

/**
 * 限制单条 tool_result 大小，超限内容写入 userData 临时文件，原消息用引用替换。
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
 * 按 token 预算截断历史消息。
 * 优先保留 system 消息、最后一条 user 消息和最近对话。
 * 截断后重新校验并修复 tool_use / tool_result 配对。
 */
export function snipHistory(
  messages: BaseMessage[],
  config: MessagePreparationConfig,
): BaseMessage[] {
  if (config.inputBudgetTokens <= 0) return messages

  const systemMsgs = messages.filter((m) => m.type === 'system')
  const nonSystem = messages.filter((m) => m.type !== 'system')

  const currentUserMsg =
    config.snipPreserveLastUser &&
    nonSystem.length > 0 &&
    nonSystem[nonSystem.length - 1].type === 'human'
      ? nonSystem[nonSystem.length - 1]
      : null

  const history = currentUserMsg ? nonSystem.slice(0, -1) : nonSystem

  const keptHistory = trimHistoryToBudget(
    history,
    config.inputBudgetTokens -
      estimateMessageTokens(systemMsgs) -
      (currentUserMsg ? estimateMessageTokens([currentUserMsg]) : 0),
  )

  const result: BaseMessage[] = config.snipPreserveSystem
    ? [...systemMsgs, ...keptHistory]
    : [...keptHistory]

  if (currentUserMsg) {
    result.push(currentUserMsg)
  }

  return backfillMissingToolResults(dropOrphanToolResults(result))
}

function trimHistoryToBudget(messages: BaseMessage[], budget: number): BaseMessage[] {
  if (budget <= 0) return []

  let total = estimateMessageTokens(messages)
  if (total <= budget) return messages

  // 优先从头部丢弃较早消息，保留最近对话
  let start = 0
  while (start < messages.length && total > budget) {
    total -= estimateMessageTokens([messages[start]])
    start++
  }

  if (start > 0) {
    // Dropped history can hide upstream message-construction bugs — keep it visible.
    log.warn('snip: 丢弃 %d/%d 条历史消息（budget %d tokens）', start, messages.length, budget)
  }

  return messages.slice(start)
}
