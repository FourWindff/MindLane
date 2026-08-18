import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import path from 'node:path'
import fs from 'node:fs'
import type { ChatMessage, ChatToolCallStep } from '../../../src/shared/lib/fileFormat.js'
import { extractTextContent } from '../utils.js'

export function checkpointMessagesToSessionMessages(messages: BaseMessage[]): ChatMessage[] {
  const toolResults = new Map<string, string>()
  const toolStepsByCall = new Map<string, ChatToolCallStep[]>()

  for (const msg of messages) {
    if (msg instanceof ToolMessage || msg.type === 'tool') {
      const toolMsg = msg as ToolMessage
      if (toolMsg.tool_call_id) {
        toolResults.set(toolMsg.tool_call_id, extractTextContent(toolMsg.content))
        const toolSteps = toolMsg.additional_kwargs?.toolSteps
        if (Array.isArray(toolSteps)) {
          toolStepsByCall.set(toolMsg.tool_call_id, toolSteps)
        }
      }
    }
  }

  const result: ChatMessage[] = []
  const pendingToolCalls: NonNullable<ChatMessage['toolCalls']> = []

  function readTimestamp(msg: BaseMessage): string | undefined {
    const metadata = (msg as unknown as { response_metadata?: Record<string, unknown> })
      .response_metadata
    return metadata?.timestamp ? String(metadata.timestamp) : undefined
  }

  for (const msg of messages) {
    const type = msg.type

    if (type === 'tool') {
      continue
    }

    if (type === 'human') {
      const chatMsg: ChatMessage = { role: 'user', content: extractTextContent(msg.content) }
      if (msg.additional_kwargs?.attachment) {
        chatMsg.attachment = msg.additional_kwargs.attachment as ChatMessage['attachment']
      }
      const ts = readTimestamp(msg)
      if (ts) chatMsg.timestamp = ts
      result.push(chatMsg)
      continue
    }

    if (type === 'system') {
      const chatMsg: ChatMessage = { role: 'system', content: extractTextContent(msg.content) }
      const ts = readTimestamp(msg)
      if (ts) chatMsg.timestamp = ts
      result.push(chatMsg)
      continue
    }

    if (type === 'ai') {
      const aiMsg = msg as AIMessage
      const content = extractTextContent(aiMsg.content)
      const toolCalls = aiMsg.tool_calls?.map((tc) => ({
        name: tc.name,
        args: tc.args as Record<string, unknown>,
        result: tc.id ? (toolResults.get(tc.id) ?? '') : '',
        steps: tc.id ? toolStepsByCall.get(tc.id) : undefined,
      }))

      if (toolCalls && toolCalls.length > 0) {
        pendingToolCalls.push(...toolCalls)
      }

      if (content) {
        const chatMsg: ChatMessage = {
          role: 'assistant',
          content,
          toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
        }
        const ts = readTimestamp(msg)
        if (ts) chatMsg.timestamp = ts
        result.push(chatMsg)
        pendingToolCalls.length = 0
      }
    }
  }

  return result
}

export class CheckpointerManager {
  private saver: SqliteSaver | null = null

  /** 初始化并指定数据库文件路径（与 SessionManager 共用同一文件） */
  async initWithDbPath(dbPath: string): Promise<void> {
    const dir = path.dirname(dbPath)
    await fs.promises.mkdir(dir, { recursive: true })
    this.saver = SqliteSaver.fromConnString(dbPath)
  }

  getAdapter(): BaseCheckpointSaver | undefined {
    return this.saver ?? undefined
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!this.saver) return
    await this.saver.deleteThread(threadId)
  }
}
