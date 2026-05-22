import { describe, expect, it, vi } from 'vitest'
import { compressMessages } from '../compression.js'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'

function createFakeModel(): BaseChatModel {
  return {
    invoke: vi.fn().mockResolvedValue(new AIMessage('这是摘要内容。')),
  } as unknown as BaseChatModel
}

describe('compressMessages', () => {
  it('returns trimmed messages when under token threshold', async () => {
    const model = createFakeModel()
    const messages = [
      new SystemMessage('System prompt'),
      new HumanMessage('Short question'),
      new AIMessage('Short answer'),
    ]

    const result = await compressMessages(messages, model)

    expect(result.length).toBe(3)
    // 未触发摘要，所以 model.invoke 不应被调用
    expect(model.invoke).not.toHaveBeenCalled()
  })

  it('triggers summary when messages exceed token threshold', async () => {
    const model = createFakeModel()
    // 构造大量中文消息以超过 6000 token 阈值
    const longChineseText = '这是一个很长的中文测试文本，'.repeat(200)
    const messages: BaseMessage[] = []
    for (let i = 0; i < 30; i++) {
      messages.push(new HumanMessage(`${longChineseText} ${i}`))
      messages.push(new AIMessage(`回复内容 ${i} ${longChineseText}`))
    }

    const result = await compressMessages(messages, model)

    // 触发了摘要，所以 model.invoke 应被调用
    expect(model.invoke).toHaveBeenCalledTimes(1)
    // 0 system + 1 summary + 10 recent
    expect(result.length).toBe(11)
    expect(result[0]).toBeInstanceOf(AIMessage)
    expect((result[0] as AIMessage).content).toMatch(/^\[对话摘要\]/)
  })

  it('preserves system messages in output', async () => {
    const model = createFakeModel()
    const messages = [
      new SystemMessage('Important system instruction'),
      new HumanMessage('User input'),
      new AIMessage('Assistant reply'),
    ]

    const result = await compressMessages(messages, model)

    const systemMsgs = result.filter((m) => m.type === 'system')
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty messages array', async () => {
    const model = createFakeModel()
    const result = await compressMessages([], model)
    expect(result).toEqual([])
  })
})
