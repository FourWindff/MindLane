import Database from 'better-sqlite3'
import type { ChatToolCall } from '../../../src/shared/lib/fileFormat.js'

export interface ChatSessionRow {
  id: string
  workspace_hash: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export interface ChatMessageRow {
  id: number
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_calls: string | null
  timestamp: string
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ChatToolCall[]
  timestamp?: string
}

export class ChatDb {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        workspace_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_updated ON chat_sessions(workspace_hash, updated_at DESC);
    `)
  }

  upsertSession(meta: ChatSessionRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO chat_sessions (id, workspace_hash, title, created_at, updated_at, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_hash = excluded.workspace_hash,
        title = excluded.title,
        updated_at = excluded.updated_at,
        message_count = excluded.message_count
    `)
    stmt.run(
      meta.id,
      meta.workspace_hash,
      meta.title,
      meta.created_at,
      meta.updated_at,
      meta.message_count,
    )
  }

  insertMessage(msg: Omit<ChatMessageRow, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, tool_calls, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(msg.session_id, msg.role, msg.content, msg.tool_calls, msg.timestamp)
  }

  deleteMessagesBySession(sessionId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM chat_messages WHERE session_id = ?
    `)
    stmt.run(sessionId)
  }

  replaceSessionMessages(
    meta: ChatSessionRow,
    messages: Array<Omit<ChatMessageRow, 'id'>>,
  ): void {
    const deleteMessages = this.db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`)
    const insertMessage = this.db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, tool_calls, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `)
    const upsertSession = this.db.prepare(`
      INSERT INTO chat_sessions (id, workspace_hash, title, created_at, updated_at, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_hash = excluded.workspace_hash,
        title = excluded.title,
        updated_at = excluded.updated_at,
        message_count = excluded.message_count
    `)

    const transaction = this.db.transaction(() => {
      deleteMessages.run(meta.id)
      upsertSession.run(
        meta.id, meta.workspace_hash, meta.title,
        meta.created_at, meta.updated_at, meta.message_count,
      )
      for (const msg of messages) {
        insertMessage.run(msg.session_id, msg.role, msg.content, msg.tool_calls, msg.timestamp)
      }
    })
    transaction()
  }

  deleteSession(sessionId: string): void {
    const deleteMessages = this.db.prepare(`
      DELETE FROM chat_messages WHERE session_id = ?
    `)
    const deleteSession = this.db.prepare(`
      DELETE FROM chat_sessions WHERE id = ?
    `)
    const transaction = this.db.transaction(() => {
      deleteMessages.run(sessionId)
      deleteSession.run(sessionId)
    })
    transaction()
  }

  getSession(sessionId: string): ChatSessionRow | undefined {
    const stmt = this.db.prepare(`
      SELECT id, workspace_hash, title, created_at, updated_at, message_count
      FROM chat_sessions WHERE id = ?
    `)
    return stmt.get(sessionId) as ChatSessionRow | undefined
  }

  listSessions(workspaceHash: string, limit?: number, offset?: number): ChatSessionRow[] {
    let sql = `
      SELECT id, workspace_hash, title, created_at, updated_at, message_count
      FROM chat_sessions
      WHERE workspace_hash = ?
      ORDER BY updated_at DESC
    `
    const args: (string | number)[] = [workspaceHash]

    if (limit !== undefined) {
      sql += ' LIMIT ?'
      args.push(limit)
      if (offset !== undefined) {
        sql += ' OFFSET ?'
        args.push(offset)
      }
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...args) as ChatSessionRow[]
  }

  getMessages(sessionId: string): ChatMessageRow[] {
    const stmt = this.db.prepare(`
      SELECT id, session_id, role, content, tool_calls, timestamp
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY id ASC
    `)
    return stmt.all(sessionId) as ChatMessageRow[]
  }

  getMostRecentSession(workspaceHash: string): ChatSessionRow | undefined {
    const stmt = this.db.prepare(`
      SELECT id, workspace_hash, title, created_at, updated_at, message_count
      FROM chat_sessions
      WHERE workspace_hash = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    return stmt.get(workspaceHash) as ChatSessionRow | undefined
  }

  close(): void {
    this.db.close()
  }
}
