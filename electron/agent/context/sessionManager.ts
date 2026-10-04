import path from 'node:path'
import type { BaseMessage } from '@langchain/core/messages'
import { SessionMessageStore, type SessionMeta } from './sessionMessageStore.js'
import type { CheckpointerManager } from '../memory/checkpointer.js'
import { checkpointMessagesToSessionMessages } from '../memory/checkpointer.js'
import type { ChatMessage } from '../../../contracts/fileFormat.js'

/**
 * Chat history manager - JSONL version
 *
 * Responsibilities:
 * 1. Persist each session's metadata and messages in a JSONL file
 * 2. Provide history to LangGraph as BaseMessage[]
 * 3. Provide history to the UI as ChatMessage[]
 * 4. Provide message compaction / truncation policies
 * 5. Support session CRUD operations
 */
export class SessionManager {
  private store: SessionMessageStore | null = null
  private checkpointer: CheckpointerManager | null = null

  /**
   * Initialize the JSONL store.
   */
  async init(userDataPath: string): Promise<void> {
    const baseDir = path.join(userDataPath, 'memory', 'sessions')

    this.store = new SessionMessageStore()
    await this.store.init(baseDir)
  }

  /**
   * Inject the CheckpointerManager (created during initAgentServices assembly, with
   * cross-wiring completed)
   */
  setCheckpointer(cp: CheckpointerManager): void {
    this.checkpointer = cp
  }

  runInWorkspace<T>(workspaceUuid: string, action: () => T): T {
    if (!this.store) throw new Error('SessionManager not initialized')
    return this.store.runInWorkspace(workspaceUuid, action)
  }

  /**
   * Load the UI messages of the given session.
   */
  async loadSessionMessages(threadId: string): Promise<ChatMessage[]> {
    if (!this.store) throw new Error('SessionManager not initialized')
    const messages = await this.store.loadMessages(threadId)
    return checkpointMessagesToSessionMessages(messages)
  }

  /**
   * Load the raw LangChain messages of the given session (including system messages).
   */
  async loadMessages(threadId: string): Promise<BaseMessage[]> {
    if (!this.store) throw new Error('SessionManager not initialized')
    return this.store.loadMessages(threadId)
  }

  /**
   * Read session metadata.
   */
  getSessionMeta(sessionId: string): SessionMeta | null {
    if (!this.store) throw new Error('SessionManager not initialized')
    return this.store.getSessionMeta(sessionId)
  }

  /**
   * Update session metadata.
   */
  async updateSessionMeta(sessionId: string, meta: SessionMeta): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.updateSessionMeta(sessionId, meta)
  }

  /**
   * Load the messages of the given session and convert them to LangChain Message format
   */
  async loadSessionBaseMessages(
    threadId: string,
    options: {
      /** Whether to include system messages (default: true) */
      includeSystem?: boolean
      /** Maximum number of messages (default: unlimited) */
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
   * List all sessions (supports pagination)
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
   * Delete a session (including its metadata file and checkpoint)
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.deleteSession(sessionId)
    await this.checkpointer?.deleteThread(sessionId)
  }

  /**
   * Persist a single LangChain message.
   */
  async saveMessage(sessionId: string, message: BaseMessage, fileUuid: string): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.saveMessage(sessionId, message, fileUuid)
  }

  /**
   * Persist LangChain messages in a batch.
   */
  async saveMessages(sessionId: string, messages: BaseMessage[], fileUuid: string): Promise<void> {
    if (!this.store) throw new Error('SessionManager not initialized')
    await this.store.saveMessages(sessionId, messages, fileUuid)
  }

  /**
   * Close resources
   */
  close(): void {
    this.store = null
    this.checkpointer = null
  }
}
