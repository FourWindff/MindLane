import { type BaseMessage } from '@langchain/core/messages'
import { estimateMessageTokens } from '../lib/tokenCounter.js'
import type { MessagePipelineConfig } from './pipelineTypes.js'
import { dropOrphanToolResults, backfillMissingToolResults } from './pipelinePairing.js'
import { logger } from '../../shared/logger.js'

const log = logger.withContext('pipeline')

/**
 * 按 token 预算截断历史消息。
 * 优先保留 system 消息、最后一条 user 消息和最近对话。
 * 截断后重新校验并修复 tool_use / tool_result 配对。
 */
export function snipHistory(messages: BaseMessage[], config: MessagePipelineConfig): BaseMessage[] {
  if (config.maxContextTokens <= 0) return messages

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
    config.maxContextTokens -
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
