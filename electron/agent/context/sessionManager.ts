import { AsyncLocalStorage } from 'node:async_hooks'
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessageToChatMessage,
  type BaseMessage,
  type StoredMessage,
} from '@langchain/core/messages'
import type { CheckpointerManager } from '../memory/checkpointer.js'
import { checkpointMessagesToSessionMessages } from '../memory/checkpointer.js'
import { logger } from '../../shared/logger.js'
import type {
  CapsuleFileRecord,
  InternalStateStore,
  SessionRecord,
} from '../../store/internalStore.js'
import type { ChatMessage } from '../../../contracts/fileFormat.js'

/** Title of a session the user has not named yet. */
export function defaultSessionTitle(now = new Date()): string {
  return `New chat ${now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

export interface SessionMeta {
  id: string
  fileUuid: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  /** Message line index archived up to (0 means nothing archived) */
  lastConsolidated?: number
  /** History summary produced by the last archive round, injected into the system prompt */
  _lastSummary?: string
}

function toSessionMeta(record: SessionRecord): SessionMeta {
  return {
    id: record.sessionId,
    fileUuid: record.fileUuid,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    // 0 means "nothing archived": the meta shape keeps the cursor absent in that case.
    ...(record.lastConsolidated > 0 ? { lastConsolidated: record.lastConsolidated } : {}),
    ...(record.summary !== null ? { _lastSummary: record.summary } : {}),
  }
}

/** Number of leading batch messages already stored at the end of the session's rows. */
function countDuplicateAppendPrefix(
  existing: readonly string[],
  appended: readonly string[],
): number {
  const maxOverlap = Math.min(existing.length, appended.length)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true
    for (let i = 0; i < overlap; i += 1) {
      if (existing[existing.length - overlap + i] !== appended[i]) {
        matches = false
        break
      }
    }
    if (matches) return overlap
  }
  return 0
}

/**
 * Chat history manager.
 *
 * The internal state store is the only persistence: session metadata, message
 * rows, the rolling summary and the compaction cursor all live in it, so there
 * is no second copy to mirror, compare or repair.
 *
 * Responsibilities:
 * 1. Persist each session's metadata and messages
 * 2. Provide history to LangGraph as BaseMessage[]
 * 3. Provide history to the UI as ChatMessage[]
 * 4. Provide message compaction / truncation policies
 * 5. Support session CRUD operations
 */
export class SessionManager {
  private stateStore: InternalStateStore | null = null
  private checkpointer: CheckpointerManager | null = null
  private readonly workspaceContext = new AsyncLocalStorage<string>()

  /**
   * Initialize the session persistence seam. The store is assembled by
   * `initAgentServices` and shared with the other state consumers; this
   * manager never closes it.
   */
  init(stateStore: InternalStateStore): void {
    this.stateStore = stateStore
  }

  /**
   * Inject the CheckpointerManager (created during initAgentServices assembly, with
   * cross-wiring completed)
   */
  setCheckpointer(cp: CheckpointerManager): void {
    this.checkpointer = cp
  }

  /** Enter the workspace context for a run: the store partitions sessions by workspace UUID. */
  runInWorkspace<T>(workspaceUuid: string, action: () => T): T {
    return this.workspaceContext.run(workspaceUuid, action)
  }

  /**
   * Load the UI messages of the given session.
   */
  async loadSessionMessages(threadId: string): Promise<ChatMessage[]> {
    const messages = await this.loadMessages(threadId)
    return checkpointMessagesToSessionMessages(messages)
  }

  /**
   * Load the raw LangChain messages of the given session (including system messages).
   */
  async loadMessages(threadId: string): Promise<BaseMessage[]> {
    const store = this.requireStateStore()
    if (!this.scopedSession(threadId)) return []

    const messages: BaseMessage[] = []
    for (const row of store.loadMessages(threadId)) {
      try {
        messages.push(mapStoredMessageToChatMessage(JSON.parse(row.payload) as StoredMessage))
      } catch (err) {
        logger.warn(
          '[SessionManager] skipping corrupt message row (session=%s, seq=%d):',
          threadId,
          row.seq,
          err,
        )
      }
    }
    return messages
  }

  /**
   * Read session metadata from the database.
   */
  getSessionMeta(sessionId: string): SessionMeta | null {
    const record = this.scopedSession(sessionId)
    return record ? toSessionMeta(record) : null
  }

  /** Update session metadata in the store. */
  async updateSessionMeta(sessionId: string, meta: SessionMeta): Promise<void> {
    this.requireScopedSession(sessionId)
    this.requireStateStore().updateSessionMeta(sessionId, {
      title: meta.title,
      ...(meta.lastConsolidated !== undefined ? { lastConsolidated: meta.lastConsolidated } : {}),
      ...(meta._lastSummary !== undefined ? { summary: meta._lastSummary } : {}),
      updatedAt: meta.updatedAt,
    })
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
    const { includeSystem = true, maxMessages } = options

    const messages = await this.loadMessages(threadId)
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
   * List all sessions (supports pagination and file filtering). The database
   * query is the only source: ordering (updatedAt descending) and pagination
   * are part of it, not re-derived by the caller.
   */
  async listSessions(
    options: { fileUuid?: string; limit?: number; offset?: number } = {},
  ): Promise<SessionMeta[]> {
    const workspaceUuid = this.requireWorkspaceUuid('listSessions')
    return this.requireStateStore()
      .listSessions({
        workspaceUuid,
        fileUuid: options.fileUuid,
        limit: options.limit,
        offset: options.offset,
      })
      .map(toSessionMeta)
  }

  /**
   * Capsule bar input in one query: files that have both a session and a path,
   * newest session activity first. Membership and ordering are the query's, not
   * the caller's to stitch together.
   */
  listCapsuleFiles(): CapsuleFileRecord[] {
    const workspaceUuid = this.requireWorkspaceUuid('list capsule files')
    return this.requireStateStore().listCapsuleFiles(workspaceUuid)
  }

  /**
   * Delete a session: one store transaction drops the session row, its messages
   * and its active-session mapping; the checkpoint thread follows.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const store = this.requireStateStore()
    const workspaceUuid = this.requireWorkspaceUuid('deleteSession')
    const record = store.getSession(sessionId)
    if (record && record.workspaceUuid === workspaceUuid) {
      store.deleteSession(sessionId)
    }
    await this.checkpointer?.deleteThread(sessionId)
  }

  /**
   * Persist a single LangChain message (append-only row, no deduplication).
   */
  async saveMessage(sessionId: string, message: BaseMessage, fileUuid: string): Promise<void> {
    await this.appendMessages(sessionId, [message], fileUuid, false)
  }

  /**
   * Persist LangChain messages in a batch (append-only rows). A batch that
   * repeats the stored tail only appends the new suffix, so a turn saved twice
   * (user message at run start, whole turn at run end) does not duplicate it.
   */
  async saveMessages(sessionId: string, messages: BaseMessage[], fileUuid: string): Promise<void> {
    await this.appendMessages(sessionId, messages, fileUuid, true)
  }

  /**
   * Close resources. The shared state store is owned by the assembly, not by
   * this manager, and stays open for the other consumers.
   */
  close(): void {
    this.stateStore = null
    this.checkpointer = null
  }

  private async appendMessages(
    sessionId: string,
    messages: BaseMessage[],
    fileUuid: string,
    dedupePrefix: boolean,
  ): Promise<void> {
    if (messages.length === 0) return
    const store = this.requireStateStore()
    const workspaceUuid = this.requireWorkspaceUuid('save messages')
    this.ensureSession(sessionId, workspaceUuid, fileUuid)

    const payloads = mapChatMessagesToStoredMessages(messages).map((stored) =>
      JSON.stringify(stored),
    )
    const appended = dedupePrefix
      ? payloads.slice(
          countDuplicateAppendPrefix(
            store.loadMessages(sessionId).map((row) => row.payload),
            payloads,
          ),
        )
      : payloads
    if (appended.length > 0) store.appendMessages(sessionId, appended)
  }

  /** Create the session row on first write; sessions are identified by the renderer. */
  private ensureSession(sessionId: string, workspaceUuid: string, fileUuid: string): void {
    const store = this.requireStateStore()
    const existing = store.getSession(sessionId)
    if (existing) {
      if (existing.workspaceUuid !== workspaceUuid) {
        throw new Error(`[SessionManager] session ${sessionId} belongs to another workspace`)
      }
      return
    }
    store.createSession({
      sessionId,
      workspaceUuid,
      fileUuid,
      title: defaultSessionTitle(),
    })
  }

  private scopedSession(sessionId: string): SessionRecord | null {
    const workspaceUuid = this.requireWorkspaceUuid('read session')
    const record = this.requireStateStore().getSession(sessionId)
    if (!record) return null
    return record.workspaceUuid === workspaceUuid ? record : null
  }

  private requireScopedSession(sessionId: string): SessionRecord {
    const record = this.scopedSession(sessionId)
    if (!record) throw new Error(`[SessionManager] unknown session: ${sessionId}`)
    return record
  }

  private requireStateStore(): InternalStateStore {
    if (!this.stateStore) throw new Error('SessionManager not initialized')
    return this.stateStore
  }

  private requireWorkspaceUuid(subject: string): string {
    const workspaceUuid = this.workspaceContext.getStore()
    if (!workspaceUuid) {
      throw new Error(
        `[SessionManager] ${subject} requires a workspace context; run session operations through runInWorkspace()`,
      )
    }
    return workspaceUuid
  }
}
