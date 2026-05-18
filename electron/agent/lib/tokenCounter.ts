import { Tiktoken } from 'js-tiktoken/lite'
import cl100k_base from 'js-tiktoken/ranks/cl100k_base'
import type { BaseMessage } from '@langchain/core/messages'

// 使用 cl100k_base（GPT-4 系列）作为通用近似估算。
// 国内中文模型（Qwen / Kimi / MiniMax）各有自己的 tokenizer，
// 但 cl100k_base 的估算仍远优于字符数 / 3 的粗估。
const encoder = new Tiktoken(cl100k_base)

export function estimateTokenCount(text: string): number {
  if (!text || text.trim().length === 0) return 0
  return encoder.encode(text).length
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content === null || content === undefined) return ''
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'object' && item !== null && 'text' in item) {
          return String(item.text ?? '')
        }
        return JSON.stringify(item)
      })
      .join(' ')
  }
  return JSON.stringify(content)
}

export function estimateMessageTokens(messages: BaseMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += estimateTokenCount(extractTextContent(m.content))
  }
  return total
}

export function isOverTokenLimit(messages: BaseMessage[], limit: number): boolean {
  return estimateMessageTokens(messages) > limit
}
