import {
  trimMessages,
  type BaseMessage,
  SystemMessage,
  HumanMessage,
  AIMessage,
} from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AGENT_LIMITS } from '../config.js'
import { estimateMessageTokens } from '../lib/tokenCounter.js'
import { messageContentToString } from '../utils.js'

export async function compressMessages(
  messages: BaseMessage[],
  model: BaseChatModel,
): Promise<BaseMessage[]> {
  if (estimateMessageTokens(messages) <= AGENT_LIMITS.summaryTriggerTokens) {
    return trimMessages(messages, {
      maxTokens: AGENT_LIMITS.maxTokens,
      strategy: 'last',
      tokenCounter: estimateMessageTokens,
      startOn: 'human',
      includeSystem: true,
    })
  }

  const systemMsgs = messages.filter((m) => m._getType() === 'system')
  const nonSystem = messages.filter((m) => m._getType() !== 'system')

  const olderMessages = nonSystem.slice(0, -10)
  const recentMessages = nonSystem.slice(-10)

  const conversationText = olderMessages
    .map((m) => {
      const role = m._getType() === 'human' ? '用户' : '助手'
      return `${role}: ${messageContentToString(m.content)}`
    })
    .join('\n')

  const summaryResponse = await model.invoke([
    new SystemMessage(
      '你是对话摘要助手。请将以下对话内容压缩为简洁的摘要，保留关键信息、用户偏好和重要结论。用中文输出，不超过 300 字。',
    ),
    new HumanMessage(conversationText),
  ])

  const summaryText = messageContentToString(summaryResponse.content).trim()

  return [
    ...systemMsgs,
    new AIMessage(`[对话摘要] ${summaryText}`),
    ...recentMessages,
  ]
}
