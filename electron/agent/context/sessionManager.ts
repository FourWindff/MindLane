import path from 'node:path'
import nodeCrypto from 'node:crypto'
import type { BaseMessage } from '@langchain/core/messages'
import { SessionMessageStore, type SessionMeta } from './sessionMessageStore.js'
import { uiMessageToBaseMessages } from './sessionMessageStore.js'
import type { CheckpointerManager } from '../memory/checkpointer.js'
import { checkpointMessagesToSessionMessages } from '../memory/checkpointer.js'
import type { ChatMessage } from '../../../src/shared/lib/fileFormat.js'

/**
 * 聊天历史管理器 - JSONL 版本
 *
 * 职责：
 * 1. 基于 JSONL 文件持久化每个会话的元数据与消息
 * 2. 为 LangGraph 提供 BaseMessage[] 格式的历史消息
 * 3. 为 UI 提供 ChatMessage[] 格式的历史消息
 * 4. 提供消息压缩/截断策略
 * 5. 支持会话的 CRUD 操作
 */
export class SessionManager {
  private store: SessionMessageStore | null = null
  private checkpointer: CheckpointerManager | null = null
  private _workspacePath: string = ''
  private _workspaceHash: string = ''

  /**
   * 初始化 JSONL 存储，可选从旧版 SQLite 迁移。
   */
  async init(dbPath: string, options?: { userDataPath?: string }): Promise<void> {
    const userDataPath = options?.userDataPath ?? path.dirname(dbPath)
    const baseDir = path.join(userDataPath, 'memory', 'sessions')

    this.store = new SessionMessageStore()
    await this.store.init(baseDir, { legacyDbPath: dbPath })
  }

  /**
   * 注入 CheckpointerManager（由 AiService 统一创建）
   */
  setCheckpointer(cp: CheckpointerManager): void {
    this.checkpointer = cp
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
    this.store?.setWorkspace(this._workspaceHash)
  }

  /**
   * 检查存储是否已完成初始化。
   */
  isReady(): boolean {
    return this.store !== null
  }

  /**
   * 加载指定会话的 UI 消息。
   */
  async loadSessionMessages(threadId: string): Promise<ChatMessage[]> {
    if (!this.store) throw new Error('SessionManager not initialized')
    const messages = await this.store.loadMessages(threadId)
    return checkpointMessagesToSessionMessages(messages)
  }

  /**
   * 加载指定会话的原始 LangChain 消息（含 system 消息）。
   */
  async loadMessages(threadId: string): Promise<BaseMessage[]> {
    if (!this.store) throw new Error('SessionManager not initialized')
    return this.store.loadMessages(threadId)
  }

  /**
   * 读取会话元数据。
   */
  getSessionMeta(sessionId: string): SessionMeta | null {
    if (!this.store) throw new Error('SessionManager not initialized')
    return this.store.getSessionMeta(sessionId)
  }

  /**
   * 更新会话元数据。
   */
  async updateSessionMeta(sessionId: string, meta: SessionMeta): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.updateSessionMeta(sessionId, meta)
  }

  /**
   * 获取会话历史文件路径（{sessionId}.history.jsonl）。
   */
  resolveHistoryPath(sessionId: string): string {
    if (!this.store) throw new Error('SessionManager not initialized')
    const sessionPath = this.store.resolveSessionPath(sessionId)
    return sessionPath.replace(/\.jsonl$/, '.history.jsonl')
  }

  /**
   * 加载指定会话的消息并转换为 LangChain Message 格式
   */
  async loadSessionBaseMessages(
    threadId: string,
    options: {
      /** 是否包含 system 消息（默认：true） */
      includeSystem?: boolean
      /** 最大消息数量限制（默认：无限制） */
      maxMessages?: number
    } = {},
  ): Promise<BaseMessage[]> {
    if (!this.store) throw new Error('SessionManager not initialized')
    const { includeSystem = true, maxMessages } = options

    const messages = await this.store.loadMessages(threadId)
    const filtered: BaseMessage[] = []

    for (const msg of messages) {
      if (msg.getType() === 'system' && !includeSystem) continue
      filtered.push(msg)
    }

    if (maxMessages && filtered.length > maxMessages) {
      return filtered.slice(-maxMessages)
    }

    return filtered
  }

  /**
   * 加载所有会话列表（支持分页）
   */
  async listSessions(limit?: number, offset?: number): Promise<SessionMeta[]> {
    if (!this.store) throw new Error('SessionManager not initialized')

    const sessions = await this.store.listSessions(this._workspaceHash)
    if (limit === undefined) return sessions
    const start = offset ?? 0
    return sessions.slice(start, start + limit)
  }

  /**
   * 保存会话元数据和 UI 消息历史。
   *
   * 仅追加本地尚未持久化的新消息，避免重复写入。
   */
  async saveSession(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')

    const storedMessages = await this.store.loadMessages(sessionId)
    const existingMeta = this.store.getSessionMeta(sessionId)
    const now = new Date().toISOString()

    // 按 UI 消息（ChatMessage）数量进行追加去重，避免 assistant 消息带
    // toolCalls 时 BaseMessage 数量膨胀导致切片错误。
    const storedChatMessages = checkpointMessagesToSessionMessages(storedMessages)
    const messagesToAppend = messages.slice(storedChatMessages.length)

    const baseMessagesToAppend: BaseMessage[] = []
    for (const msg of messagesToAppend) {
      baseMessagesToAppend.push(...uiMessageToBaseMessages(msg))
    }

    if (baseMessagesToAppend.length > 0) {
      await this.store.saveMessages(sessionId, baseMessagesToAppend)
    }

    // 更新标题与元数据
    let title: string
    if (existingMeta?.title) {
      title = existingMeta.title
    } else {
      const firstUserMessage = messages.find((m) => m.role === 'user')
      if (firstUserMessage) {
        const content = firstUserMessage.content
        title = content.slice(0, 30) + (content.length > 30 ? '...' : '')
      } else {
        title = `新对话 ${new Date().toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}`
      }
    }

    if (title !== existingMeta?.title) {
      const meta: SessionMeta = {
        id: sessionId,
        title,
        createdAt: existingMeta?.createdAt ?? now,
        updatedAt: now,
        messageCount: storedMessages.length + baseMessagesToAppend.length,
        lastConsolidated: existingMeta?.lastConsolidated,
        _lastSummary: existingMeta?._lastSummary,
      }
      await this.store.updateSessionMeta(sessionId, meta)
    }
  }

  /**
   * 删除会话（包括元数据文件和 checkpoint）
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.deleteSession(sessionId)
    await this.checkpointer?.deleteThread(sessionId)
  }

  /**
   * 获取最近使用的会话 ID
   */
  async getMostRecentSessionId(): Promise<string | null> {
    if (!this.store) throw new Error('SessionManager not initialized')
    const sessions = await this.store.listSessions(this._workspaceHash)
    return sessions[0]?.id ?? null
  }

  /**
   * 持久化单条 LangChain 消息。
   */
  async saveMessage(sessionId: string, message: BaseMessage): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.saveMessage(sessionId, message)
  }

  /**
   * 批量持久化 LangChain 消息。
   */
  async saveMessages(sessionId: string, messages: BaseMessage[]): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.saveMessages(sessionId, messages)
  }

  /**
   * 关闭资源
   */
  close(): void {
    this.store = null
    this.checkpointer = null
  }
}
