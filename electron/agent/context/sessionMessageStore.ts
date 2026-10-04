import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type StoredMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessageToChatMessage,
} from '@langchain/core/messages'
import { logger } from '../../shared/logger.js'
import { atomicWrite } from '../../fs/atomicWrite.js'
import type { ChatMessage, ChatToolCall } from '../../../contracts/fileFormat.js'

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

/**
 * JSONL-based session message store.
 *
 * Each session maps to one file: `{baseDir}/{workspaceUuid}/{sessionId}.jsonl`
 * The first line is SessionMetadata; every line after that is a serialized
 * LangChain BaseMessage.
 */
export class SessionMessageStore {
  private baseDir = ''
  private readonly workspaceContext = new AsyncLocalStorage<string>()
  private readonly writeLocks = new Map<string, Promise<void>>()

  /**
   * Initialize the store root directory.
   */
  async init(baseDir: string): Promise<void> {
    this.baseDir = baseDir
    await this.ensureDir(this.baseDir)
  }

  /**
   * Enter the given workspace context; every session operation keys off its dir.
   * The identity travels once per run (the ALS is the only source): no instance
   * field is kept that a missing writer could silently blank out.
   */
  runInWorkspace<T>(workspaceUuid: string, action: () => T): T {
    return this.workspaceContext.run(workspaceUuid, action)
  }

  /**
   * Append a single LangChain message to the session file and update the first-line metadata.
   */
  async saveMessage(sessionId: string, message: BaseMessage, fileUuid: string): Promise<void> {
    await this.appendMessages(sessionId, [message], fileUuid, false)
  }

  /**
   * Append LangChain messages to the session file in a batch and update the first-line metadata.
   * The whole batch completes under one write lock, guaranteeing atomicity.
   */
  async saveMessages(sessionId: string, messages: BaseMessage[], fileUuid: string): Promise<void> {
    await this.appendMessages(sessionId, messages, fileUuid, true)
  }

  private async appendMessages(
    sessionId: string,
    messages: BaseMessage[],
    fileUuid: string,
    dedupePrefix: boolean,
  ): Promise<void> {
    if (messages.length === 0) return
    const sessionPath = this.resolveSessionPath(sessionId)
    await this.withWriteLock(sessionId, async () => {
      await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true })
      const lines = this.readLines(sessionPath)
      const meta = this.parseMetadata(lines[0]) ?? this.defaultMeta(sessionId, fileUuid)
      const stored = mapChatMessagesToStoredMessages(messages)
      const duplicatePrefixLength = dedupePrefix
        ? this.countDuplicateAppendPrefix(lines, stored)
        : 0
      for (const s of stored.slice(duplicatePrefixLength)) {
        lines.push(JSON.stringify(s))
      }
      meta.messageCount = lines.length - 1
      meta.updatedAt = new Date().toISOString()
      lines[0] = JSON.stringify(meta)
      await atomicWrite(sessionPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''))
    })
  }

  /**
   * Read all history messages of a session, skipping corrupt lines and logging a warning.
   */
  async loadMessages(sessionId: string): Promise<BaseMessage[]> {
    const sessionPath = this.resolveSessionPath(sessionId)
    if (!fs.existsSync(sessionPath)) return []

    const lines = this.readLines(sessionPath)
    const result: BaseMessage[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      try {
        const stored = JSON.parse(line) as StoredMessage
        result.push(mapStoredMessageToChatMessage(stored))
      } catch (err) {
        logger.warn(
          `[SessionMessageStore] skipping corrupt message line (session=${sessionId}, line=${i + 1}):`,
          err,
        )
      }
    }
    return result
  }

  /**
   * List all session metadata under the given workspace, sorted by updatedAt descending.
   */
  async listSessions(workspaceUuid: string): Promise<SessionMeta[]> {
    const dir = path.join(this.baseDir, workspaceUuid)
    if (!fs.existsSync(dir)) return []

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const sessions: SessionMeta[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const sessionPath = path.join(dir, entry.name)
      const meta = this.readFirstLineMetadata(sessionPath)
      if (meta) sessions.push(meta)
    }

    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }

  /**
   * Delete the session file.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionPath = this.resolveSessionPath(sessionId)
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
    }
  }

  /**
   * Read session metadata; returns null when the file does not exist.
   */
  getSessionMeta(sessionId: string): SessionMeta | null {
    const sessionPath = this.resolveSessionPath(sessionId)
    if (!fs.existsSync(sessionPath)) return null
    return this.readFirstLineMetadata(sessionPath)
  }

  /**
   * Atomically create a session file with metadata and optional initial messages.
   * Used for migration or bulk-write scenarios.
   */
  async createSession(
    sessionId: string,
    meta: SessionMeta,
    messages: BaseMessage[] = [],
  ): Promise<void> {
    const sessionPath = this.resolveSessionPath(sessionId)
    await this.withWriteLock(sessionId, async () => {
      await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true })
      const lines: string[] = [JSON.stringify(meta)]
      if (messages.length > 0) {
        const stored = mapChatMessagesToStoredMessages(messages)
        for (const s of stored) lines.push(JSON.stringify(s))
      }
      await atomicWrite(sessionPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''))
    })
  }

  /**
   * Update only the first-line session metadata without touching message content.
   */
  async updateSessionMeta(sessionId: string, meta: SessionMeta): Promise<void> {
    const sessionPath = this.resolveSessionPath(sessionId)
    await this.withWriteLock(sessionId, async () => {
      const lines = this.readLines(sessionPath)
      if (lines.length === 0) {
        lines.push(JSON.stringify(meta))
      } else {
        lines[0] = JSON.stringify(meta)
      }
      await atomicWrite(sessionPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''))
    })
  }

  resolveSessionPath(sessionId: string): string {
    return path.join(this.baseDir, this.getWorkspaceUuid(), `${sessionId}.jsonl`)
  }

  getWorkspaceUuid(): string {
    const workspaceUuid = this.workspaceContext.getStore()
    if (!workspaceUuid) {
      throw new Error(
        '[SessionMessageStore] missing workspace context (workspaceUuid); run session operations through runInWorkspace()',
      )
    }
    return workspaceUuid
  }

  private defaultMeta(sessionId: string, fileUuid: string): SessionMeta {
    const now = new Date().toISOString()
    return {
      id: sessionId,
      fileUuid,
      title: `New chat ${new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    }
  }

  private parseMetadata(line?: string): SessionMeta | null {
    if (!line) return null
    try {
      const parsed = JSON.parse(line) as Partial<SessionMeta>
      if (
        typeof parsed.id === 'string' &&
        typeof parsed.fileUuid === 'string' &&
        typeof parsed.title === 'string' &&
        typeof parsed.createdAt === 'string' &&
        typeof parsed.updatedAt === 'string' &&
        typeof parsed.messageCount === 'number'
      ) {
        return {
          ...parsed,
          lastConsolidated:
            typeof parsed.lastConsolidated === 'number' ? parsed.lastConsolidated : undefined,
          _lastSummary: typeof parsed._lastSummary === 'string' ? parsed._lastSummary : undefined,
        } as SessionMeta
      }
    } catch {
      // ignore
    }
    return null
  }

  private readLines(filePath: string): string[] {
    if (!fs.existsSync(filePath)) return ['']
    const content = fs.readFileSync(filePath, 'utf-8')
    if (!content) return ['']
    const lines = content.split(/\r?\n/)
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }
    return lines
  }

  private readFirstLineMetadata(filePath: string): SessionMeta | null {
    if (!fs.existsSync(filePath)) return null
    try {
      const fd = fs.openSync(filePath, 'r')
      try {
        const buffer = Buffer.alloc(4096)
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
        const firstNewline = buffer.subarray(0, bytesRead).indexOf('\n')
        const line =
          firstNewline >= 0
            ? buffer.subarray(0, firstNewline).toString('utf-8')
            : buffer.subarray(0, bytesRead).toString('utf-8')
        return this.parseMetadata(line)
      } finally {
        fs.closeSync(fd)
      }
    } catch (err) {
      logger.warn(
        `[SessionMessageStore] failed to read the session header line (${filePath}):`,
        err,
      )
      return null
    }
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.promises.mkdir(dir, { recursive: true })
  }

  private countDuplicateAppendPrefix(lines: string[], stored: StoredMessage[]): number {
    const messageLineCount = Math.max(0, lines.length - 1)
    const maxOverlap = Math.min(messageLineCount, stored.length)
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
      let matches = true
      for (let i = 0; i < overlap; i += 1) {
        const existingLine = lines[lines.length - overlap + i]
        try {
          const existing = JSON.parse(existingLine) as StoredMessage
          if (JSON.stringify(existing) !== JSON.stringify(stored[i])) {
            matches = false
            break
          }
        } catch {
          matches = false
          break
        }
      }
      if (matches) return overlap
    }
    return 0
  }

  private async withWriteLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.writeLocks.get(sessionId) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(() => fn())
    this.writeLocks.set(sessionId, current)
    try {
      await current
    } finally {
      if (this.writeLocks.get(sessionId) === current) {
        this.writeLocks.delete(sessionId)
      }
    }
  }
}

export function uiMessageToBaseMessages(msg: ChatMessage): BaseMessage[] {
  const additionalKwargs: Record<string, unknown> = {}
  const responseMetadata: Record<string, unknown> = {}
  if (msg.timestamp) responseMetadata.timestamp = msg.timestamp

  if (msg.role === 'user') {
    if (msg.attachment) additionalKwargs.attachment = msg.attachment
    return [
      new HumanMessage({
        content: msg.content,
        additional_kwargs: additionalKwargs,
        response_metadata: responseMetadata,
      }),
    ]
  }
  if (msg.role === 'system') {
    return [
      new SystemMessage({
        content: msg.content,
        additional_kwargs: additionalKwargs,
        response_metadata: responseMetadata,
      }),
    ]
  }
  if (msg.role === 'assistant') {
    const toolCalls = msg.toolCalls?.map((tc, idx): ChatToolCall & { id: string } => ({
      ...tc,
      id: `call-${idx}`,
    }))
    const result: BaseMessage[] = []
    if (toolCalls && toolCalls.length > 0) {
      result.push(
        new AIMessage({
          content: msg.content,
          tool_calls: toolCalls,
          additional_kwargs: additionalKwargs,
          response_metadata: responseMetadata,
        }),
      )
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]
        const original = msg.toolCalls?.[i]
        result.push(
          new ToolMessage({
            tool_call_id: tc.id,
            name: tc.name,
            content: original?.result ?? '',
            additional_kwargs: tc.steps ? { toolSteps: tc.steps } : {},
          }),
        )
      }
    } else {
      result.push(
        new AIMessage({
          content: msg.content,
          additional_kwargs: additionalKwargs,
          response_metadata: responseMetadata,
        }),
      )
    }
    return result
  }
  return []
}
