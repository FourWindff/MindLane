import type { BaseMessage } from '@langchain/core/messages'

/**
 * Extract text from LangChain message content.
 * Anthropic format returns content as an array [{type:"text", text:"..."}]
 * OpenAI format returns content as a string
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'text' &&
          'text' in block,
      )
      .map((block) => block.text)
      .join('')
  }
  return ''
}

/**
 * Find the text of the latest non-empty human message (shared by the
 * subgraph input resolvers; single implementation so the two copies
 * cannot drift apart).
 */
export function findLatestUserMessageText(messages: BaseMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.getType() === 'human') {
      const text = extractTextContent(message.content)
      if (text.trim()) {
        return text
      }
    }
  }
  return null
}

/**
 * Loosely stringify LangChain message content.
 *
 * Differences from {@link extractTextContent}:
 * - `extractTextContent` strictly filters blocks shaped like `{ type: "text", text: ... }`;
 * - `messageContentToString` does not check `type`: any block carrying a `text`
 *   field is stringified, plain string blocks in the array are kept, and all
 *   blocks are joined.
 *
 * Meant for providers that return irregular content shapes (e.g. a vision model
 * putting JSON text in an object with no `type:"text"` marker).
 */
export function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return ''
}

/**
 * Turn any string into a filename-safe form: keep only letters, digits,
 * underscores and hyphens; replace everything else with an underscore; and
 * truncate to the given length (default 64).
 */
export function sanitizeFileName(name: string, maxLength = 64): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLength)
}

/** Clamp value into the [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type ContentBlock = { type?: string; [key: string]: unknown }

/**
 * Clean Anthropic streaming artifacts out of an AI message content array.
 *
 * Some providers (Anthropic among them) still keep `input_json_delta` blocks
 * in the final response; those blocks are not a standard message type and
 * trigger "Unable to coerce message from array: Received: {}" when LangGraph
 * serializes the checkpoint / reducer. This function merges each delta into the
 * `tool_use` block at the same index and removes every delta.
 */
export function sanitizeAIMessageContent(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content

  const deltas = new Map<number, string>()
  for (let i = 0; i < content.length; i++) {
    const block = content[i] as ContentBlock
    if (
      block &&
      typeof block === 'object' &&
      block.type === 'input_json_delta' &&
      typeof block.input === 'string'
    ) {
      deltas.set(i, (deltas.get(i) ?? '') + block.input)
    }
  }

  return content
    .map((block, idx) => {
      const b = block as ContentBlock
      if (b && typeof b === 'object' && b.type === 'tool_use' && deltas.has(idx)) {
        return { ...b, input: (b.input ?? '') + (deltas.get(idx) ?? '') }
      }
      return block
    })
    .filter((block) => {
      const b = block as ContentBlock
      return !(b && typeof b === 'object' && b.type === 'input_json_delta')
    })
}

/**
 * Format agent-layer errors uniformly so the text always carries a message and,
 * when available, a stack.
 *
 * - Error instances: `${name}: ${message}\n${stack}` with a stack, message alone otherwise
 * - Non-Error values: String() coercion; null → 'null', undefined → 'Unknown error'
 */
export function formatAgentError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const name = 'name' in error ? `${String((error as Record<string, unknown>).name)}: ` : ''
    const stack = 'stack' in error ? String((error as Record<string, unknown>).stack) : ''
    return stack || name + String((error as Record<string, unknown>).message)
  }
  if (error === undefined) return 'Unknown error'
  if (error === null) return 'null'
  return String(error)
}
