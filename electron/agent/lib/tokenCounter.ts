import { Tiktoken } from 'js-tiktoken/lite'
import cl100k_base from 'js-tiktoken/ranks/cl100k_base'
import type { BaseMessage } from '@langchain/core/messages'
import { messageContentToString } from '../utils.js'

// cl100k_base (the GPT-4 family) is used as a general-purpose approximation.
// Chinese-focused models (Qwen / Kimi / MiniMax) each have their own tokenizer,
// but the cl100k_base estimate still beats the crude characters / 3 approximation by far.
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
