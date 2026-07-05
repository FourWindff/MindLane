/**
 * 从 LangChain message content 中提取文本
 * Anthropic 格式返回 content 是数组 [{type:"text", text:"..."}]
 * OpenAI 格式返回 content 是字符串
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
 * 将 LangChain message content 宽松地字符串化。
 *
 * 与 {@link extractTextContent} 的区别：
 * - `extractTextContent` 严格筛选 `{ type: "text", text: ... }` 形态的 block；
 * - `messageContentToString` 不检查 `type`，只要 block 上带 `text` 字段就字符串化，
 *   同时保留数组中纯字符串 block 的内容，并 join 所有 block。
 *
 * 适用于视觉模型等返回 content 形态不规范的场景（例如某些 provider 把 JSON
 * 文本放在没有 `type:"text"` 标记的对象中）。
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
 * 把任意字符串转成适合作为文件名的安全形式：仅保留字母、数字、下划线和连字符，
 * 其余字符替换为下划线，并截断到指定长度（默认 64）。
 */
export function sanitizeFileName(name: string, maxLength = 64): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLength)
}

/** 把 value 限制在 [min, max] 范围内。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type ContentBlock = { type?: string; [key: string]: unknown }

/**
 * 清理 AI 消息 content 数组中的 Anthropic 流式伪影。
 *
 * 某些 provider（如 Anthropic）在完整响应中仍保留 `input_json_delta`
 * 块；这些块不属于标准消息类型，会在 LangGraph checkpoint / reducer
 * 序列化时导致 "Unable to coerce message from array: Received: {}" 错误。
 * 该函数把 delta 内容合并到对应索引的 `tool_use` 块，并移除所有 delta。
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
 * 统一格式化 Agent 层错误，确保错误信息包含消息和堆栈。
 *
 * - Error 实例：返回 `${name}: ${message}\n${stack}`（有堆栈时）或仅 message
 * - 非 Error 值：用 String() 转换，null → 'null'，undefined → 'Unknown error'
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
