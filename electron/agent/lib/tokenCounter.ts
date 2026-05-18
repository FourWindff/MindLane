import { Tiktoken } from 'js-tiktoken/lite'
import cl100k_base from 'js-tiktoken/ranks/cl100k_base'
import type { BaseMessage } from '@langchain/core/messages'
import { messageContentToString } from '../utils.js'

// 使用 cl100k_base（GPT-4 系列）作为通用近似估算。
// 国内中文模型（Qwen / Kimi / MiniMax）各有自己的 tokenizer，
// 但 cl100k_base 的估算仍远优于字符数 / 3 的粗估。
const encoder = new Tiktoken(cl100k_base)

export function estimateTokenCount(text: string): number {
  if (!text) return 0
  return encoder.encode(text).length
}

export function estimateMessageTokens(messages: BaseMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += estimateTokenCount(messageContentToString(m.content))
  }
  return total
}
