import Database from 'better-sqlite3'
import type { ChatMessage } from '../../../src/shared/lib/fileFormat.js'

export interface ChatSessionRow {
  id: string
  workspace_hash: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export type { ChatMessage }
export type SessionMessage = ChatMessage

export class ChatDb {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.cleanupOldTables()
    this.initSchema()
  }

  private cleanupOldTables(): void {
    const legacyMessageColumns = this.db.prepare(`
      PRAGMA table_info(chat_messages)
    `).all() as Array<{ name: string }>
    if (
      legacyMessageColumns.length > 0
      && !legacyMessageColumns.some((column) => column.name === 'message_json')
    ) {
      this.db.exec('DROP TABLE IF EXISTS chat_messages;')
    }

    this.db.exec(`
      DROP INDEX IF EXISTS idx_chat_messages_session;
    `)
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
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_updated ON chat_sessions(workspace_hash, updated_at DESC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        message_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq ON chat_messages(session_id, seq);
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

  deleteSession(sessionId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId)
    })
    transaction()
  }

  appendMessages(sessionId: string, messages: ChatMessage[]): void {
    if (messages.length === 0) return

    const nextSeqRow = this.db.prepare(`
      SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq
      FROM chat_messages
      WHERE session_id = ?
    `).get(sessionId) as { next_seq: number }

    const insert = this.db.prepare(`
      INSERT INTO chat_messages (session_id, seq, message_json, created_at)
      VALUES (?, ?, ?, ?)
    `)

    const transaction = this.db.transaction((items: ChatMessage[]) => {
      items.forEach((message, index) => {
        const createdAt = message.timestamp ?? new Date().toISOString()
        insert.run(sessionId, nextSeqRow.next_seq + index, JSON.stringify(message), createdAt)
      })
    })

    transaction(messages)
  }

  replaceMessages(sessionId: string, messages: ChatMessage[]): void {
    const transaction = this.db.transaction((items: ChatMessage[]) => {
      this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId)
      this.appendMessages(sessionId, items)
    })

    transaction(messages)
  }

  listMessages(sessionId: string): ChatMessage[] {
    const rows = this.db.prepare(`
      SELECT message_json
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY seq ASC
    `).all(sessionId) as Array<{ message_json: string }>

    return rows.map((row) => JSON.parse(row.message_json) as ChatMessage)
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
