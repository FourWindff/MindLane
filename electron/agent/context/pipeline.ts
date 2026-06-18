import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { MessagePipelineConfig } from './pipelineTypes.js'
import { dropOrphanToolResults, backfillMissingToolResults } from './pipelinePairing.js'
import { microcompact, applyToolResultBudget } from './pipelineCompaction.js'
import { snipHistory } from './pipelineSnip.js'
import { sanitizeAIMessageContent } from '../utils.js'

import { logger } from '../../shared/logger.js'

export type { MessagePipelineConfig } from './pipelineTypes.js'
export { mergeMessagePipelineConfig } from './pipelineTypes.js'

/**
 * 预处理消息数组，按固定顺序组合 7 个步骤：
 * 1. drop orphan tool_results
 * 2. backfill missing tool_results
 * 3. microcompact
 * 4. apply tool_result budget
 * 5. snip history
 * 6. drop orphan tool_results
 * 7. backfill missing tool_results
 *
 * 返回处理后的新数组；不修改原始数组，也不写入 session。
 */
export async function preprocessMessages(
  messages: BaseMessage[],
  config: MessagePipelineConfig,
  userDataPath?: string,
): Promise<BaseMessage[]> {
  if (!config.enabled) return messages

  const validMessages = messages.filter((m, i): m is BaseMessage => {
    const isValid = Boolean(
      m &&
        typeof m === 'object' &&
        'type' in m &&
        typeof (m as { getType?: unknown }).getType === 'function',
    )
    if (!isValid) {
      logger.warn('[preprocessMessages] dropping invalid input message at %d: %o', i, m)
    }
    return isValid
  }).map((m) => {
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
  result = microcompact(result, config)
  result = await applyToolResultBudget(result, config, userDataPath)
  result = snipHistory(result, config)
  result = dropOrphanToolResults(result)
  result = backfillMissingToolResults(result)

  for (let i = 0; i < result.length; i++) {
    const m = result[i]
    if (!m || typeof m !== 'object' || !('type' in m)) {
      logger.warn('[preprocessMessages] invalid output message at %d: %o', i, m)
    }
  }

  return result
}
