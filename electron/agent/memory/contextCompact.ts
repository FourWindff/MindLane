import type { BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { estimateTokenCount } from '../lib/tokenCounter.js'

/**
 * Detect whether an error is a prompt-too-long / context-overflow error.
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
 * Estimate the token count of the tools' schemas.
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
 * Trim to the most recent message window, keeping system messages and the current user message.
 *
 * Used in two places:
 * 1. Over-budget fallback before pre-call compaction (keep the recent window);
 * 2. Supervisor's non-LLM trim retry (drop old messages and retry once on prompt-too-long).
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
