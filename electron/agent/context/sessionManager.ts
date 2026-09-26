import path from 'node:path'
import type { BaseMessage } from '@langchain/core/messages'
import { SessionMessageStore, type SessionMeta } from './sessionMessageStore.js'
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
  private _workspaceUuid: string = ''

  /**
   * 初始化 JSONL 存储。
   */
  async init(userDataPath: string): Promise<void> {
    const baseDir = path.join(userDataPath, 'memory', 'sessions')

    this.store = new SessionMessageStore()
    await this.store.init(baseDir)
  }

  /**
   * 注入 CheckpointerManager（由 initAgentServices 装配时创建并完成交叉接线）
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
   * 当前工作区 UUID
   */
  get workspaceUuid(): string {
    return this._workspaceUuid
  }

  /**
   * 设置工作区路径与稳定 UUID
   */
  setWorkspace(workspacePath: string, workspaceUuid: string): void {
    this._workspacePath = workspacePath
    this._workspaceUuid = workspaceUuid
    this.store?.setWorkspace(this._workspaceUuid)
  }

  runInWorkspace<T>(workspaceUuid: string, action: () => T): T {
    if (!this.store) throw new Error('SessionManager not initialized')
    return this.store.runInWorkspace(workspaceUuid, action)
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
  async listSessions(
    options: { fileUuid?: string; limit?: number; offset?: number } = {},
  ): Promise<SessionMeta[]> {
    if (!this.store) throw new Error('SessionManager not initialized')

    const allSessions = await this.store.listSessions(this.store.getWorkspaceUuid())
    const sessions = options.fileUuid
      ? allSessions.filter((session) => session.fileUuid === options.fileUuid)
      : allSessions
    if (options.limit === undefined) return sessions
    const start = options.offset ?? 0
    return sessions.slice(start, start + options.limit)
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
   * 持久化单条 LangChain 消息。
   */
  async saveMessage(sessionId: string, message: BaseMessage, fileUuid: string): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.saveMessage(sessionId, message, fileUuid)
  }

  /**
   * 批量持久化 LangChain 消息。
   */
  async saveMessages(sessionId: string, messages: BaseMessage[], fileUuid: string): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.saveMessages(sessionId, messages, fileUuid)
  }

  /**
   * 关闭资源
   */
  close(): void {
    this.store = null
    this.checkpointer = null
  }
}
