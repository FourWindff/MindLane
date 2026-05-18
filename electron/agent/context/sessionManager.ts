import fs from 'node:fs'
import path from 'node:path'
import nodeCrypto from 'node:crypto'
import type { BaseMessage } from '@langchain/core/messages'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { compressMessages } from '../memory/compression.js'
import type { LLMProvider } from '../providers/index.js'
import { ChatDb } from '../db/chatDb.js'
import type { ChatSessionRow, SessionMessage, SessionMeta } from '../db/chatDb.js'
export type { SessionMessage, SessionMeta } from '../db/chatDb.js'

/**
 * 聊天历史管理器 - SQLite 版本
 *
 * 职责：
 * 1. 从 SQLite 加载指定会话的历史消息
 * 2. 将存储格式转换为 LangChain Message 格式
 * 3. 提供消息压缩/截断策略
 * 4. 支持会话的 CRUD 操作
 * 5. 支持从旧版 JSON 文件迁移数据
 */
export class SessionManager {
  private db: ChatDb | null = null
  private _workspacePath: string = ''
  private _workspaceHash: string = ''

  /**
   * 初始化 ChatDb，可选从旧版数据迁移
   */
  init(dbPath: string, options?: { userDataPath?: string }): void {
    this.db = new ChatDb(dbPath)
    if (options?.userDataPath) {
      this.migrateFromLegacy(options.userDataPath)
    }
  }

  /**
   * 当前工作区路径
   */
  get workspacePath(): string {
    return this._workspacePath
  }

  /**
   * 当前工作区哈希（MD5 前 12 位）
   */
  get workspaceHash(): string {
    return this._workspaceHash
  }

  /**
   * 设置工作区路径并计算哈希
   */
  setWorkspace(workspacePath: string): void {
    this._workspacePath = workspacePath
    this._workspaceHash = nodeCrypto
      .createHash('md5')
      .update(workspacePath)
      .digest('hex')
      .slice(0, 12)
  }

  /**
   * 从旧版 JSON 文件迁移数据到 SQLite
   */
  private migrateFromLegacy(userDataPath: string): void {
    const chatHistoryDir = path.join(userDataPath, 'chat-history')
    if (!fs.existsSync(chatHistoryDir)) {
      return
    }

    try {
      const entries = fs.readdirSync(chatHistoryDir, { withFileTypes: true })
      const workspaceDirs = entries.filter((e) => e.isDirectory())

      for (const dir of workspaceDirs) {
        const wsDir = path.join(chatHistoryDir, dir.name)
        const sessionsMetaPath = path.join(wsDir, 'sessions.json')

        if (!fs.existsSync(sessionsMetaPath)) continue

        const metaData = JSON.parse(fs.readFileSync(sessionsMetaPath, 'utf-8'))
        const sessions: Array<{
          id: string
          title: string
          createdAt: string
          updatedAt: string
          messageCount: number
        }> = Array.isArray(metaData.sessions) ? metaData.sessions : []

        for (const session of sessions) {
          const sessionFilePath = path.join(wsDir, `${session.id}.json`)
          if (!fs.existsSync(sessionFilePath)) continue

          const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8'))
          const messages: Array<{
            role: 'user' | 'assistant' | 'system'
            content: string
            toolCalls?: Array<{
              name: string
              args: Record<string, unknown>
              result: string
            }>
            timestamp?: string
          }> = Array.isArray(sessionData.messages) ? sessionData.messages : []

          // Insert session metadata
          const row: ChatSessionRow = {
            id: session.id,
            workspace_hash: dir.name,
            title: session.title,
            created_at: session.createdAt,
            updated_at: session.updatedAt,
            message_count: messages.length,
          }
          this.db!.upsertSession(row)

          // Insert messages
          for (const msg of messages) {
            this.db!.insertMessage({
              session_id: session.id,
              role: msg.role,
              content: msg.content,
              tool_calls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
              timestamp: msg.timestamp ?? session.updatedAt,
            })
          }
        }
      }

      // Rename chat-history to chat-history.migrated
      fs.renameSync(chatHistoryDir, `${chatHistoryDir}.migrated`)
      console.log('[SessionManager] Legacy data migration completed successfully')
    } catch (error) {
      console.error('[SessionManager] Legacy data migration failed:', error)
    }
  }

  /**
   * 加载指定会话的历史消息
   */
  async loadHistory(threadId: string): Promise<SessionMessage[]> {
    if (!this.db) throw new Error('SessionManager not initialized')

    const rows = this.db.getMessages(threadId)
    return rows.map((row) => ({
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      timestamp: row.timestamp,
    }))
  }

  /**
   * 加载指定会话的历史消息并转换为 LangChain Message 格式
   */
  async loadHistoryAsMessages(
    threadId: string,
    options: {
      /** 是否包含 system 消息（默认：true） */
      includeSystem?: boolean
      /** 最大消息数量限制（默认：无限制） */
      maxMessages?: number
    } = {},
  ): Promise<BaseMessage[]> {
    const { includeSystem = true, maxMessages } = options

    const stored = await this.loadHistory(threadId)
    const messages: BaseMessage[] = []

    for (const msg of stored) {
      if (msg.role === 'system' && !includeSystem) continue

      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content))
      } else if (msg.role === 'assistant') {
        messages.push(new AIMessage(msg.content))
      } else if (msg.role === 'system') {
        messages.push(new SystemMessage(msg.content))
      }
    }

    if (maxMessages && messages.length > maxMessages) {
      return messages.slice(-maxMessages)
    }

    return messages
  }

  /**
   * 加载并压缩历史消息，用于 LLM 上下文
   */
  async buildContextMessages(
    threadId: string,
    provider: LLMProvider,
    currentUserMessage?: string,
  ): Promise<BaseMessage[]> {
    const messages = await this.loadHistoryAsMessages(threadId, {
      includeSystem: false,
    })

    if (currentUserMessage) {
      messages.push(new HumanMessage(currentUserMessage))
    }

    return compressMessages(messages, provider.reasoningModel)
  }

  /**
   * 加载所有会话列表（支持分页）
   */
  async listSessions(
    limit?: number,
    offset?: number,
  ): Promise<SessionMeta[]> {
    if (!this.db) throw new Error('SessionManager not initialized')

    const rows = this.db.listSessions(this._workspaceHash, limit, offset)
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
    }))
  }

  /**
   * 保存会话历史
   */
  async saveSession(
    sessionId: string,
    messages: SessionMessage[],
  ): Promise<void> {
    if (!this.db) throw new Error('SessionManager not initialized')

    const now = new Date().toISOString()

    // Check if session exists and has a non-empty title
    const existing = this.db.getSession(sessionId)
    let title: string

    if (existing && existing.title) {
      title = existing.title
    } else {
      const firstUserMessage = messages.find((m) => m.role === 'user')
      if (firstUserMessage) {
        const content = firstUserMessage.content
        title =
          content.slice(0, 30) + (content.length > 30 ? '...' : '')
      } else {
        title = `新对话 ${new Date().toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}`
      }
    }

    this.db.replaceSessionMessages(
      {
        id: sessionId,
        workspace_hash: this._workspaceHash,
        title,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        message_count: messages.length,
      },
      messages.map((msg) => ({
        session_id: sessionId,
        role: msg.role,
        content: msg.content,
        tool_calls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        timestamp: msg.timestamp ?? now,
      })),
    )
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.db) throw new Error('SessionManager not initialized')
    this.db.deleteSession(sessionId)
  }

  /**
   * 获取最近使用的会话 ID
   */
  async getMostRecentSessionId(): Promise<string | null> {
    if (!this.db) throw new Error('SessionManager not initialized')
    const recent = this.db.getMostRecentSession(this._workspaceHash)
    return recent ? recent.id : null
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db?.close()
    this.db = null
  }
}
