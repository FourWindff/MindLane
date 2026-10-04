import { describe, expect, it } from 'vitest'
import { estimateTokenCount, estimateMessageTokens } from '../tokenCounter.js'
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
    // Chinese sample, escaped so the file itself stays ASCII: "This is a Chinese test sentence, used to verify token counting."
    const text =
      '\u8fd9\u662f\u4e00\u4e2a\u4e2d\u6587\u6d4b\u8bd5\u53e5\u5b50\uff0c\u7528\u6765\u9a8c\u8bc1token\u8ba1\u6570\u3002'
    const count = estimateTokenCount(text)
    const roughEstimate = Math.ceil(text.length / 3)
    // cl100k_base: Chinese is roughly 0.7-1 tokens/char, still better than the crude length/3 estimate
    expect(count).toBeGreaterThan(text.length * 0.5)
    expect(count).toBeLessThan(text.length * 3)
    // The old estimate (length/3) undercounts badly
    expect(count).toBeGreaterThan(roughEstimate * 1.5)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0)
  })
})

describe('estimateMessageTokens', () => {
  it('sums tokens across multiple messages', () => {
    const messages = [
      new HumanMessage('Hello'),
      new AIMessage('Hello world'),
      new SystemMessage('You are a system prompt'),
    ]
    const count = estimateMessageTokens(messages)
    expect(count).toBeGreaterThan(5)
    expect(count).toBeLessThan(30)
  })

  it('ignores non-text blocks in multimodal content', () => {
    // The image_url block has no `text` field, so messageContentToString drops it;
    // otherwise the base64 url would be encoded in full and the token count would explode.
    const textOnly = [new HumanMessage('Look at this')]
    const multimodal = [
      new HumanMessage({
        content: [
          { type: 'text', text: 'Look at this' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,AAAA'.repeat(1000) },
          },
        ],
      }),
    ]
    expect(estimateMessageTokens(multimodal)).toBe(estimateMessageTokens(textOnly))
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
