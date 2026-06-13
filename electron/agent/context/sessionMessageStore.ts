import fs from 'node:fs'
import path from 'node:path'
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
import type { ChatMessage, ChatToolCall } from '../../../src/shared/lib/fileFormat.js'

export interface SessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface SessionMessageStoreOptions {
  /** 旧版 SQLite 数据库路径，存在时执行一次性迁移 */
  legacyDbPath?: string
}

/**
 * 基于 JSONL 的会话消息存储。
 *
 * 每个会话对应一个文件：`{baseDir}/{workspaceHash}/{sessionId}.jsonl`
 * 文件首行为 SessionMetadata，后续每行为一条 LangChain BaseMessage 的序列化对象。
 */
export class SessionMessageStore {
  private baseDir = ''
  private workspaceHash = ''
  private legacyDbPath?: string
  private migrationPromise: Promise<void> | null = null
  private readonly writeLocks = new Map<string, Promise<void>>()

  /**
   * 初始化存储根目录。
   */
  async init(baseDir: string, options?: SessionMessageStoreOptions): Promise<void> {
    this.baseDir = baseDir
    this.legacyDbPath = options?.legacyDbPath
    await this.ensureDir(this.baseDir)
    await this.runMigrationIfNeeded()
  }

  /**
   * 设置当前工作区哈希，所有会话操作均基于该目录。
   */
  setWorkspace(workspaceHash: string): void {
    this.workspaceHash = workspaceHash
  }

  /**
   * 追加单条 LangChain 消息到对应会话文件，并更新首行元数据。
   */
  async saveMessage(sessionId: string, message: BaseMessage): Promise<void> {
    await this.saveMessages(sessionId, [message])
  }

  /**
   * 批量追加 LangChain 消息到对应会话文件，并更新首行元数据。
   * 整个批次在同一写锁内完成，保证原子性。
   */
  async saveMessages(sessionId: string, messages: BaseMessage[]): Promise<void> {
    if (messages.length === 0) return
    const sessionPath = this.resolveSessionPath(sessionId)
    await this.withWriteLock(sessionId, async () => {
      await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true })
      const lines = this.readLines(sessionPath)
      const meta = this.parseMetadata(lines[0]) ?? this.defaultMeta(sessionId)
      const stored = mapChatMessagesToStoredMessages(messages)
      for (const s of stored) {
        lines.push(JSON.stringify(s))
      }
      meta.messageCount = lines.length - 1
      meta.updatedAt = new Date().toISOString()
      lines[0] = JSON.stringify(meta)
      this.atomicWrite(sessionPath, lines)
    })
  }

  /**
   * 读取会话的全部历史消息，跳过损坏行并记录警告。
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
          `[SessionMessageStore] 跳过损坏的消息行 (session=${sessionId}, line=${i + 1}):`,
          err,
        )
      }
    }
    return result
  }

  /**
   * 列出指定工作区下的所有会话元数据，按 updatedAt 降序排列。
   */
  async listSessions(workspaceHash: string): Promise<SessionMeta[]> {
    const dir = path.join(this.baseDir, workspaceHash)
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
   * 删除会话文件。
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionPath = this.resolveSessionPath(sessionId)
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
    }
  }

  /**
   * 读取会话元数据，文件不存在时返回 null。
   */
  getSessionMeta(sessionId: string): SessionMeta | null {
    const sessionPath = this.resolveSessionPath(sessionId)
    if (!fs.existsSync(sessionPath)) return null
    return this.readFirstLineMetadata(sessionPath)
  }

  /**
   * 原子创建会话文件，包含元数据与可选的初始消息。
   * 用于迁移或批量写入场景。
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
      this.atomicWrite(sessionPath, lines)
    })
  }

  /**
   * 仅更新会话首行元数据，不修改消息内容。
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
      this.atomicWrite(sessionPath, lines)
    })
  }

  private resolveSessionPath(sessionId: string): string {
    if (!this.workspaceHash) {
      throw new Error('[SessionMessageStore] workspaceHash 未设置，请先调用 setWorkspace()')
    }
    return path.join(this.baseDir, this.workspaceHash, `${sessionId}.jsonl`)
  }

  private defaultMeta(sessionId: string): SessionMeta {
    const now = new Date().toISOString()
    return {
      id: sessionId,
      title: `新对话 ${new Date().toLocaleString('zh-CN', {
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
        typeof parsed.title === 'string' &&
        typeof parsed.createdAt === 'string' &&
        typeof parsed.updatedAt === 'string' &&
        typeof parsed.messageCount === 'number'
      ) {
        return parsed as SessionMeta
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
      logger.warn(`[SessionMessageStore] 读取会话首行失败 (${filePath}):`, err)
      return null
    }
  }

  private atomicWrite(filePath: string, lines: string[]): void {
    const tempPath = `${filePath}.tmp`
    const data = lines.join('\n') + (lines.length > 0 ? '\n' : '')
    fs.writeFileSync(tempPath, data, 'utf-8')
    fs.renameSync(tempPath, filePath)
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.promises.mkdir(dir, { recursive: true })
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

  // ─── 旧版 SQLite 迁移 ───

  private async runMigrationIfNeeded(): Promise<void> {
    if (!this.legacyDbPath || !fs.existsSync(this.legacyDbPath)) return

    const markerPath = path.join(path.dirname(this.legacyDbPath), '.migrated-to-jsonl')
    if (fs.existsSync(markerPath)) return

    if (!this.migrationPromise) {
      this.migrationPromise = this.migrateFromLegacyDb(markerPath)
    }
    try {
      await this.migrationPromise
    } finally {
      this.migrationPromise = null
    }
  }

  private async migrateFromLegacyDb(markerPath: string): Promise<void> {
    logger.info('[SessionMessageStore] 检测到旧版 SQLite 数据库，开始迁移...')
    try {
      const { default: Database } = await import('better-sqlite3')
      const db = new Database(this.legacyDbPath!)
      try {
        const sessionRows = db
          .prepare(
            'SELECT id, workspace_hash, title, created_at, updated_at, message_count FROM chat_sessions ORDER BY updated_at DESC',
          )
          .all() as Array<{
            id: string
            workspace_hash: string
            title: string
            created_at: string
            updated_at: string
            message_count: number
          }>

        const messageStmt = this.prepareLegacyMessageStmt(db)
      if (!messageStmt) {
        logger.warn('[SessionMessageStore] 旧版数据库缺少 message_json 列，跳过消息迁移')
      } else {
        for (const row of sessionRows) {
          const messageRows = messageStmt.all(row.id) as Array<{ message_json: string }>
          const messages: BaseMessage[] = []
          for (const { message_json } of messageRows) {
            try {
              const chatMsg = JSON.parse(message_json) as ChatMessage
              messages.push(...uiMessageToBaseMessages(chatMsg))
            } catch (err) {
              logger.warn(
                `[SessionMessageStore] 迁移时跳过损坏的消息 (session=${row.id}):`,
                err,
              )
            }
          }

          const meta: SessionMeta = {
            id: row.id,
            title: row.title,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: messages.length,
          }

          // 临时设置 workspaceHash 以写入正确目录
          const savedHash = this.workspaceHash
          this.workspaceHash = row.workspace_hash
          try {
            await this.createSession(row.id, meta, messages)
          } finally {
            this.workspaceHash = savedHash
          }
        }
      }
    } finally {
      db.close()
    }

    const timestamp = Date.now()
    const backupPath = `${this.legacyDbPath!}.bak.${timestamp}`
    fs.renameSync(this.legacyDbPath!, backupPath)
    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8')
    logger.info('[SessionMessageStore] 迁移完成，原数据库已备份到:', backupPath)
  } catch (err) {
    logger.error('[SessionMessageStore] 迁移失败，保留原数据库:', err)
    // 不阻断启动，下次初始化仍会重试
  }
}

  private prepareLegacyMessageStmt(db: unknown): { all: (sessionId: string) => unknown[] } | null {
    type ColumnInfo = { name: string }
    type BetterSqlite3Database = {
      prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] }
    }
    const typedDb = db as BetterSqlite3Database
    try {
      const columns = typedDb.prepare("PRAGMA table_info(chat_messages)").all() as ColumnInfo[]
      if (!columns.some((c) => c.name === 'message_json')) {
        return null
      }
      return typedDb.prepare(
        'SELECT message_json FROM chat_messages WHERE session_id = ? ORDER BY seq ASC',
      ) as { all: (sessionId: string) => unknown[] }
    } catch {
      return null
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
