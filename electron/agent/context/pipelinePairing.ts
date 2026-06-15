import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'

/**
 * 删除没有对应 tool_use 的孤儿 tool_result 消息
 */
export function dropOrphanToolResults(messages: BaseMessage[]): BaseMessage[] {
  const toolCallIds = new Set<string>()

  for (const msg of messages) {
    if (msg.type === 'ai') {
      const aiMsg = msg as AIMessage
      for (const tc of aiMsg.tool_calls ?? []) {
        if (tc.id) {
          toolCallIds.add(tc.id)
        }
      }
    }
  }

  return messages.filter((msg) => {
    if (msg.type !== 'tool') return true
    const toolMsg = msg as ToolMessage
    return toolCallIds.has(toolMsg.tool_call_id)
  })
}

const MISSING_TOOL_RESULT_PLACEHOLDER =
  '[Tool result unavailable — call was interrupted or lost]'

/**
 * 为没有对应 tool_result 的 tool_use 插入占位结果。
 * 占位消息紧跟在对应的 AI tool_use 消息之后，保持原有顺序。
 */
export function backfillMissingToolResults(messages: BaseMessage[]): BaseMessage[] {
  const existingResultIds = new Set<string>()
  for (const msg of messages) {
    if (msg.type === 'tool') {
      existingResultIds.add((msg as ToolMessage).tool_call_id)
    }
  }

  const result: BaseMessage[] = []
  for (const msg of messages) {
    result.push(msg)

    if (msg.type !== 'ai') continue
    const aiMsg = msg as AIMessage
    for (const tc of aiMsg.tool_calls ?? []) {
      if (tc.id && !existingResultIds.has(tc.id)) {
        result.push(
          new ToolMessage({
            tool_call_id: tc.id,
            name: tc.name,
            content: MISSING_TOOL_RESULT_PLACEHOLDER,
          }),
        )
        existingResultIds.add(tc.id)
      }
    }
  }

  return result
}
