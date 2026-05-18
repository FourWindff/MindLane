import { describe, expect, it } from 'vitest'
import { estimateTokenCount, estimateMessageTokens, isOverTokenLimit } from '../tokenCounter.js'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

describe('estimateTokenCount', () => {
  it('counts English text approximately 1 token per 3-4 chars', () => {
    const text = 'Hello world, this is a test of the token counter.'
    const count = estimateTokenCount(text)
    // cl100k_base: roughly 11-12 tokens
    expect(count).toBeGreaterThan(8)
    expect(count).toBeLessThan(20)
  })

  it('counts Chinese text far more accurately than length/3', () => {
    const text = '这是一个中文测试句子，用来验证token计数。'
    const count = estimateTokenCount(text)
    const roughEstimate = Math.ceil(text.length / 3)
    // cl100k_base: 中文约 0.7-1 tokens/字符，仍优于 length/3 粗估
    expect(count).toBeGreaterThan(text.length * 0.5)
    expect(count).toBeLessThan(text.length * 3)
    // 旧估算（length/3）会严重低估
    expect(count).toBeGreaterThan(roughEstimate * 1.5)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0)
  })

  it('returns 0 for whitespace-only string', () => {
    expect(estimateTokenCount('   \n\t')).toBe(0)
  })
})

describe('estimateMessageTokens', () => {
  it('sums tokens across multiple messages', () => {
    const messages = [
      new HumanMessage('Hello'),
      new AIMessage('你好世界'),
      new SystemMessage('System prompt'),
    ]
    const count = estimateMessageTokens(messages)
    expect(count).toBeGreaterThan(5)
    expect(count).toBeLessThan(30)
  })

  it('handles array content (multimodal)', () => {
    const messages = [
      new HumanMessage({
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
        ],
      }),
    ]
    const count = estimateMessageTokens(messages)
    expect(count).toBeGreaterThan(0)
  })

  it('handles empty messages array', () => {
    expect(estimateMessageTokens([])).toBe(0)
  })

  it('counts system messages correctly', () => {
    const messages = [new SystemMessage('You are a helpful assistant.')]
    const count = estimateMessageTokens(messages)
    expect(count).toBeGreaterThan(4)
    expect(count).toBeLessThan(15)
  })
})

describe('isOverTokenLimit', () => {
  it('returns true when over limit', () => {
    const messages = [new HumanMessage('Hello world this is a test message with many words')]
    expect(isOverTokenLimit(messages, 1)).toBe(true)
  })

  it('returns false when under limit', () => {
    const messages = [new HumanMessage('Hi')]
    expect(isOverTokenLimit(messages, 100)).toBe(false)
  })
})
