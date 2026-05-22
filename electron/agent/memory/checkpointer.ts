import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import path from 'node:path'
import fs from 'node:fs'
import type { SessionMessage } from '../db/chatDb.js'
import { extractTextContent } from '../utils.js'

export function checkpointMessagesToSessionMessages(messages: BaseMessage[]): SessionMessage[] {
  const toolResults = new Map<string, string>()

  for (const msg of messages) {
    if (msg instanceof ToolMessage || msg.type === 'tool') {
      const toolMsg = msg as ToolMessage
      if (toolMsg.tool_call_id) {
        toolResults.set(toolMsg.tool_call_id, extractTextContent(toolMsg.content))
      }
    }
  }

  const result: SessionMessage[] = []
  const pendingToolCalls: NonNullable<SessionMessage['toolCalls']> = []

  for (const msg of messages) {
    const type = msg.type

    if (type === 'tool') {
      continue
    }

    if (type === 'human') {
      result.push({ role: 'user', content: extractTextContent(msg.content) })
      continue
    }

    if (type === 'system') {
      result.push({ role: 'system', content: extractTextContent(msg.content) })
      continue
    }

    if (type === 'ai') {
      const aiMsg = msg as AIMessage
      const content = extractTextContent(aiMsg.content)
      const toolCalls = aiMsg.tool_calls?.map((tc) => ({
        name: tc.name,
        args: tc.args as Record<string, unknown>,
        result: tc.id ? (toolResults.get(tc.id) ?? '') : '',
      }))

      if (toolCalls && toolCalls.length > 0) {
        pendingToolCalls.push(...toolCalls)
      }

      if (content) {
        result.push({
          role: 'assistant',
          content,
          toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
        })
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

  /** 兼容旧初始化方式（使用独立的 checkpoints.db） */
  async init(userDataPath: string): Promise<void> {
    const dir = path.join(userDataPath, 'memory')
    await fs.promises.mkdir(dir, { recursive: true })
    const dbPath = path.join(dir, 'checkpoints.db')
    this.saver = SqliteSaver.fromConnString(dbPath)
  }

  get(): SqliteSaver | null {
    return this.saver
  }

  getAdapter(): BaseCheckpointSaver | undefined {
    return this.saver ?? undefined
  }

  async getMessages(threadId: string): Promise<SessionMessage[]> {
    if (!this.saver) return []
    const tuple = await this.saver.getTuple({ configurable: { thread_id: threadId } })
    if (!tuple) return []
    const messages = tuple.checkpoint.channel_values?.messages as BaseMessage[] | undefined
    if (!messages || !Array.isArray(messages)) return []
    return checkpointMessagesToSessionMessages(messages)
  }

  async getMessageCount(threadId: string): Promise<number> {
    const messages = await this.getMessages(threadId)
    return messages.length
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!this.saver) return
    await this.saver.deleteThread(threadId)
  }
}
