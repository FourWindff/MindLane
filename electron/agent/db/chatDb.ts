import Database from 'better-sqlite3'

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

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }>
  timestamp?: string
}

export class ChatDb {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.cleanupOldTables()
    this.initSchema()
  }

  private cleanupOldTables(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS chat_messages;
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
    const stmt = this.db.prepare(`
      DELETE FROM chat_sessions WHERE id = ?
    `)
    stmt.run(sessionId)
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
