import type { BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { estimateTokenCount } from '../lib/tokenCounter.js'

/**
 * 检测错误是否为 prompt-too-long / 上下文超限类错误
 */
export function isPromptTooLongError(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return (
    message.includes('prompt_too_long') ||
    message.includes('too many tokens') ||
    message.includes('413') ||
    message.includes('context length') ||
    message.includes('maximum context length') ||
    message.includes('token limit')
  )
}

/**
 * 估算工具 schema 的 token 数
 */
export function estimateToolsSchemaTokens(tools: StructuredToolInterface[]): number {
  let total = 0
  for (const tool of tools) {
    const toolAny = tool as unknown as Record<string, unknown>
    const schema =
      toolAny.schema || (tool as unknown as { lc_kwargs?: { schema?: unknown } }).lc_kwargs?.schema
    if (schema) {
      total += estimateTokenCount(JSON.stringify(schema))
    }
  }
  return total
}

/**
 * 裁剪到最近消息窗口，保留 system 消息和当前用户消息。
 *
 * 用于两处：
 * 1. 调用前压缩的超预算兜底（保留最近窗口）；
 * 2. supervisor 的非 LLM 裁剪重试（prompt-too-long 时裁掉旧消息重试一次）。
 */
export function trimToRecentWindow(messages: BaseMessage[], recentCount: number): BaseMessage[] {
  const systemMsgs = messages.filter((m) => m.type === 'system')
  const nonSystem = messages.filter((m) => m.type !== 'system')

  const currentUserMsg =
    nonSystem.length > 0 && nonSystem[nonSystem.length - 1].type === 'human'
      ? nonSystem[nonSystem.length - 1]
      : null

  const history = currentUserMsg ? nonSystem.slice(0, -1) : nonSystem
  const recent = history.slice(-recentCount)

  return [...systemMsgs, ...recent, ...(currentUserMsg ? [currentUserMsg] : [])]
}
