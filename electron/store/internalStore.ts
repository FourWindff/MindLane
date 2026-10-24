import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/** Current schema version stored in `PRAGMA user_version`. */
export const SCHEMA_VERSION = 1

/** Ring cap: once reached, the oldest node edit entries are dropped on append. */
export const EDIT_LOG_MAX_ENTRIES = 200

export interface SessionRecord {
  sessionId: string
  workspaceUuid: string
  fileUuid: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  /** Message sequence archived up to (0 means nothing archived). */
  lastConsolidated: number
  /** Rolling summary of the archived conversation. */
  summary: string | null
}

export interface SessionMessageRecord {
  seq: number
  /** Serialized message payload; the store treats it as opaque text. */
  payload: string
  createdAt: string
}

export interface CreateSessionInput {
  sessionId: string
  workspaceUuid: string
  fileUuid: string
  title: string
  createdAt?: string
  updatedAt?: string
}

export interface SessionMetaPatch {
  title?: string
  lastConsolidated?: number
  summary?: string | null
  updatedAt?: string
}

export interface ListSessionsQuery {
  workspaceUuid: string
  fileUuid?: string
  limit?: number
  offset?: number
}

export interface FilePathRecord {
  fileUuid: string
  path: string
  updatedAt: string
}

export interface ActiveSessionRecord {
  fileUuid: string
  sessionId: string
}

export interface CapsuleFileRecord {
  fileUuid: string
  filePath: string
  /** ISO timestamp of the file's most recent session; the capsule bar's only sort key. */
  lastActivityAt: string
}

export interface EditLogEntry {
  ts: number
  nodeId: string
  before: string
  after: string
}

export interface InternalStoreOptions {
  /** Injectable clock so ordering assertions stay deterministic. */
  now?: () => string
}

export type OpenInternalStoreResult =
  { ok: true; store: InternalStateStore } | { ok: false; error: string }

/**
 * The only handle consumers get. SQL, schema checks and partitioning stay
 * behind this seam: callers never see a table, a statement or a database path
 * they could query directly.
 */
export interface InternalStateStore {
  createSession(input: CreateSessionInput): SessionRecord
  getSession(sessionId: string): SessionRecord | null
  listSessions(query: ListSessionsQuery): SessionRecord[]
  updateSessionMeta(sessionId: string, patch: SessionMetaPatch): SessionRecord

  appendMessages(sessionId: string, payloads: readonly string[]): void
  loadMessages(sessionId: string): SessionMessageRecord[]
  deleteSession(sessionId: string): void

  setActiveSession(workspaceUuid: string, fileUuid: string, sessionId: string): void
  getActiveSession(workspaceUuid: string, fileUuid: string): string | null
  listActiveSessions(workspaceUuid: string): ActiveSessionRecord[]

  setFilePath(workspaceUuid: string, fileUuid: string, filePath: string): void
  getFilePath(workspaceUuid: string, fileUuid: string): string | null
  listFilePaths(workspaceUuid: string): FilePathRecord[]
  /**
   * Re-point the path index after a rename or move. One UPDATE: a file path is
   * replaced, every path under a renamed folder is rewritten with the same prefix.
   */
  moveFilePath(oldPath: string, newPath: string): void
  /**
   * Drop the identity row and active-session mapping at a deleted path (a file,
   * or every file under a deleted folder). Session data is retained.
   */
  deleteFileIdentitiesAtPath(targetPath: string): void
  /** Drops the path index and active-session mapping; sessions and files stay untouched. */
  deleteFileIdentity(workspaceUuid: string, fileUuid: string): void

  /**
   * Capsule bar input in one query: files that have both a session and a path,
   * newest session activity first. Membership and ordering are the query's, not
   * the caller's to stitch together.
   */
  listCapsuleFiles(workspaceUuid: string): CapsuleFileRecord[]

  appendEditLog(workspaceUuid: string, fileUuid: string, entry: EditLogEntry): void
  readEditLog(workspaceUuid: string, fileUuid: string): EditLogEntry[]
  clearEditLog(workspaceUuid: string, fileUuid: string): void

  close(): void
}

const SESSION_COLUMNS = `
  session_id, workspace_uuid, file_uuid, title, created_at, updated_at,
  message_count, last_consolidated, summary
`

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  workspace_uuid TEXT NOT NULL,
  file_uuid TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_consolidated INTEGER NOT NULL DEFAULT 0,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS sessions_workspace_updated
  ON sessions(workspace_uuid, updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_workspace_file_updated
  ON sessions(workspace_uuid, file_uuid, updated_at DESC);

CREATE TABLE IF NOT EXISTS session_messages (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE TRIGGER IF NOT EXISTS session_messages_append_only
BEFORE UPDATE ON session_messages
BEGIN
  SELECT RAISE(ABORT, 'session messages are append-only');
END;

CREATE TABLE IF NOT EXISTS active_sessions (
  file_uuid TEXT PRIMARY KEY,
  workspace_uuid TEXT NOT NULL,
  session_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS active_sessions_workspace
  ON active_sessions(workspace_uuid);

CREATE TABLE IF NOT EXISTS file_paths (
  file_uuid TEXT PRIMARY KEY,
  workspace_uuid TEXT NOT NULL,
  path TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS file_paths_workspace_path
  ON file_paths(workspace_uuid, path);

CREATE TABLE IF NOT EXISTS edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_uuid TEXT NOT NULL,
  file_uuid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS edit_log_file
  ON edit_log(workspace_uuid, file_uuid, id);
`

const REQUIRED_SCHEMA_OBJECTS = [
  'sessions',
  'session_messages',
  'session_messages_append_only',
  'active_sessions',
  'file_paths',
  'edit_log',
] as const

interface SessionRow {
  session_id: string
  workspace_uuid: string
  file_uuid: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  last_consolidated: number
  summary: string | null
}

interface MessageRow {
  seq: number
  payload: string
  created_at: string
}

interface FilePathRow {
  file_uuid: string
  path: string
  updated_at: string
}

interface CapsuleFileRow {
  file_uuid: string
  path: string
  last_activity_at: string
}

interface ActiveSessionRow {
  file_uuid: string
  session_id: string
}

interface EditLogRow {
  ts: number
  node_id: string
  before_text: string
  after_text: string
}

function toSession(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    workspaceUuid: row.workspace_uuid,
    fileUuid: row.file_uuid,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    lastConsolidated: row.last_consolidated,
    summary: row.summary,
  }
}

function toMessage(row: MessageRow): SessionMessageRecord {
  return { seq: row.seq, payload: row.payload, createdAt: row.created_at }
}

function toEditLogEntry(row: EditLogRow): EditLogEntry {
  return { ts: row.ts, nodeId: row.node_id, before: row.before_text, after: row.after_text }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireId(value: string, label: string): string {
  if (!value) throw new Error(`[InternalStateStore] missing ${label}`)
  return value
}

function assertSchemaComplete(db: Database.Database): void {
  const objects = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger')")
    .all() as Array<{ name: string }>
  const present = new Set(objects.map((object) => object.name))
  const missing = REQUIRED_SCHEMA_OBJECTS.filter((name) => !present.has(name))
  if (missing.length > 0) {
    throw new Error(`schema is incomplete (missing: ${missing.join(', ')})`)
  }
}

class SqliteInternalStateStore implements InternalStateStore {
  private closed = false

  constructor(
    private readonly db: Database.Database,
    private readonly now: () => string,
  ) {}

  createSession(input: CreateSessionInput): SessionRecord {
    const sessionId = requireId(input.sessionId, 'session id')
    const workspaceUuid = requireId(input.workspaceUuid, 'workspace UUID')
    const fileUuid = requireId(input.fileUuid, 'file UUID')
    if (this.getSession(sessionId)) {
      throw new Error(`[InternalStateStore] session already exists: ${sessionId}`)
    }

    const createdAt = input.createdAt ?? this.now()
    const updatedAt = input.updatedAt ?? createdAt
    this.db
      .prepare(`INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL)`)
      .run(sessionId, workspaceUuid, fileUuid, input.title, createdAt, updatedAt)
    return this.requireSession(sessionId)
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db
      .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE session_id = ?`)
      .get(requireId(sessionId, 'session id')) as SessionRow | undefined
    return row ? toSession(row) : null
  }

  listSessions(query: ListSessionsQuery): SessionRecord[] {
    const workspaceUuid = requireId(query.workspaceUuid, 'workspace UUID')
    const params: unknown[] = [workspaceUuid]
    let sql = `SELECT ${SESSION_COLUMNS} FROM sessions WHERE workspace_uuid = ?`
    if (query.fileUuid !== undefined) {
      sql += ' AND file_uuid = ?'
      params.push(query.fileUuid)
    }
    sql += ' ORDER BY updated_at DESC, created_at DESC, session_id ASC'
    if (query.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }
    if (query.offset !== undefined) {
      if (query.limit === undefined) sql += ' LIMIT -1'
      sql += ' OFFSET ?'
      params.push(query.offset)
    }
    const rows = this.db.prepare(sql).all(...params) as SessionRow[]
    return rows.map(toSession)
  }

  updateSessionMeta(sessionId: string, patch: SessionMetaPatch): SessionRecord {
    const id = requireId(sessionId, 'session id')
    const assignments: string[] = []
    const params: unknown[] = []
    if (patch.title !== undefined) {
      assignments.push('title = ?')
      params.push(patch.title)
    }
    if (patch.lastConsolidated !== undefined) {
      assignments.push('last_consolidated = ?')
      params.push(patch.lastConsolidated)
    }
    if (patch.summary !== undefined) {
      assignments.push('summary = ?')
      params.push(patch.summary)
    }
    assignments.push('updated_at = ?')
    params.push(patch.updatedAt ?? this.now())
    params.push(id)

    const result = this.db
      .prepare(`UPDATE sessions SET ${assignments.join(', ')} WHERE session_id = ?`)
      .run(...params)
    if (result.changes === 0) throw new Error(`[InternalStateStore] unknown session: ${id}`)
    return this.requireSession(id)
  }

  appendMessages(sessionId: string, payloads: readonly string[]): void {
    const id = requireId(sessionId, 'session id')
    if (payloads.length === 0) return
    this.requireSession(id)

    const createdAt = this.now()
    const insert = this.db.prepare(
      `INSERT INTO session_messages (session_id, seq, payload, created_at) VALUES (?, ?, ?, ?)`,
    )
    const nextSeq = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM session_messages WHERE session_id = ?')
      .pluck()
    const bumpSession = this.db.prepare(
      'UPDATE sessions SET message_count = message_count + ?, updated_at = ? WHERE session_id = ?',
    )

    this.db.transaction(() => {
      let seq = (nextSeq.get(id) as number) + 1
      for (const payload of payloads) insert.run(id, seq++, payload, createdAt)
      bumpSession.run(payloads.length, createdAt, id)
    })()
  }

  loadMessages(sessionId: string): SessionMessageRecord[] {
    const rows = this.db
      .prepare(
        'SELECT seq, payload, created_at FROM session_messages WHERE session_id = ? ORDER BY seq ASC',
      )
      .all(requireId(sessionId, 'session id')) as MessageRow[]
    return rows.map(toMessage)
  }

  deleteSession(sessionId: string): void {
    const id = requireId(sessionId, 'session id')
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM active_sessions WHERE session_id = ?').run(id)
      this.db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(id)
      this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(id)
    })()
  }

  setActiveSession(workspaceUuid: string, fileUuid: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO active_sessions (file_uuid, workspace_uuid, session_id) VALUES (?, ?, ?)
         ON CONFLICT(file_uuid) DO UPDATE SET
           workspace_uuid = excluded.workspace_uuid,
           session_id = excluded.session_id`,
      )
      .run(
        requireId(fileUuid, 'file UUID'),
        requireId(workspaceUuid, 'workspace UUID'),
        requireId(sessionId, 'session id'),
      )
  }

  getActiveSession(workspaceUuid: string, fileUuid: string): string | null {
    const row = this.db
      .prepare('SELECT session_id FROM active_sessions WHERE workspace_uuid = ? AND file_uuid = ?')
      .get(requireId(workspaceUuid, 'workspace UUID'), requireId(fileUuid, 'file UUID')) as
      { session_id: string } | undefined
    return row?.session_id ?? null
  }

  listActiveSessions(workspaceUuid: string): ActiveSessionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT file_uuid, session_id FROM active_sessions WHERE workspace_uuid = ? ORDER BY file_uuid ASC',
      )
      .all(requireId(workspaceUuid, 'workspace UUID')) as ActiveSessionRow[]
    return rows.map((row) => ({ fileUuid: row.file_uuid, sessionId: row.session_id }))
  }

  setFilePath(workspaceUuid: string, fileUuid: string, filePath: string): void {
    this.db
      .prepare(
        `INSERT INTO file_paths (file_uuid, workspace_uuid, path, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(file_uuid) DO UPDATE SET
           workspace_uuid = excluded.workspace_uuid,
           path = excluded.path,
           updated_at = excluded.updated_at`,
      )
      .run(
        requireId(fileUuid, 'file UUID'),
        requireId(workspaceUuid, 'workspace UUID'),
        requireId(filePath, 'file path'),
        this.now(),
      )
  }

  getFilePath(workspaceUuid: string, fileUuid: string): string | null {
    const row = this.db
      .prepare('SELECT path FROM file_paths WHERE workspace_uuid = ? AND file_uuid = ?')
      .get(requireId(workspaceUuid, 'workspace UUID'), requireId(fileUuid, 'file UUID')) as
      { path: string } | undefined
    return row?.path ?? null
  }

  listFilePaths(workspaceUuid: string): FilePathRecord[] {
    const rows = this.db
      .prepare(
        'SELECT file_uuid, path, updated_at FROM file_paths WHERE workspace_uuid = ? ORDER BY path ASC',
      )
      .all(requireId(workspaceUuid, 'workspace UUID')) as FilePathRow[]
    return rows.map((row) => ({
      fileUuid: row.file_uuid,
      path: row.path,
      updatedAt: row.updated_at,
    }))
  }

  moveFilePath(oldPath: string, newPath: string): void {
    const from = requireId(oldPath, 'old path')
    const to = requireId(newPath, 'new path')
    // `substr(path, 1, length(from) + 1)` compares exact prefixes, so a sibling
    // like `notes-2` never matches the `notes` folder rename and LIKE wildcards
    // in file names cannot leak into the match.
    this.db
      .prepare(
        `UPDATE file_paths
         SET path = ? || substr(path, length(?) + 1), updated_at = ?
         WHERE path = ? OR substr(path, 1, length(?) + 1) IN (? || '/', ? || '\\')`,
      )
      .run(to, from, this.now(), from, from, from, from)
  }

  deleteFileIdentitiesAtPath(targetPath: string): void {
    const target = requireId(targetPath, 'target path')
    const match = `path = ? OR substr(path, 1, length(?) + 1) IN (? || '/', ? || '\\')`
    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM active_sessions WHERE file_uuid IN (
             SELECT file_uuid FROM file_paths WHERE ${match}
           )`,
        )
        .run(target, target, target, target)
      this.db.prepare(`DELETE FROM file_paths WHERE ${match}`).run(target, target, target, target)
    })()
  }

  listCapsuleFiles(workspaceUuid: string): CapsuleFileRecord[] {
    const ws = requireId(workspaceUuid, 'workspace UUID')
    const rows = this.db
      .prepare(
        `SELECT p.file_uuid AS file_uuid, p.path AS path, MAX(s.updated_at) AS last_activity_at
         FROM sessions s
         JOIN file_paths p
           ON p.workspace_uuid = s.workspace_uuid AND p.file_uuid = s.file_uuid
         WHERE s.workspace_uuid = ?
         GROUP BY p.file_uuid, p.path
         ORDER BY last_activity_at DESC, p.path ASC`,
      )
      .all(ws) as CapsuleFileRow[]
    return rows.map((row) => ({
      fileUuid: row.file_uuid,
      filePath: row.path,
      lastActivityAt: row.last_activity_at,
    }))
  }

  deleteFileIdentity(workspaceUuid: string, fileUuid: string): void {
    const ws = requireId(workspaceUuid, 'workspace UUID')
    const file = requireId(fileUuid, 'file UUID')
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM file_paths WHERE workspace_uuid = ? AND file_uuid = ?')
        .run(ws, file)
      this.db
        .prepare('DELETE FROM active_sessions WHERE workspace_uuid = ? AND file_uuid = ?')
        .run(ws, file)
    })()
  }

  appendEditLog(workspaceUuid: string, fileUuid: string, entry: EditLogEntry): void {
    const ws = requireId(workspaceUuid, 'workspace UUID')
    const file = requireId(fileUuid, 'file UUID')
    const insert = this.db.prepare(
      `INSERT INTO edit_log (workspace_uuid, file_uuid, ts, node_id, before_text, after_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const trim = this.db.prepare(
      `DELETE FROM edit_log
       WHERE workspace_uuid = ? AND file_uuid = ?
         AND id <= (
           SELECT id FROM edit_log
           WHERE workspace_uuid = ? AND file_uuid = ?
           ORDER BY id DESC LIMIT 1 OFFSET ?
         )`,
    )
    this.db.transaction(() => {
      insert.run(ws, file, entry.ts, entry.nodeId, entry.before, entry.after)
      trim.run(ws, file, ws, file, EDIT_LOG_MAX_ENTRIES)
    })()
  }

  readEditLog(workspaceUuid: string, fileUuid: string): EditLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT ts, node_id, before_text, after_text FROM edit_log
         WHERE workspace_uuid = ? AND file_uuid = ? ORDER BY id ASC`,
      )
      .all(
        requireId(workspaceUuid, 'workspace UUID'),
        requireId(fileUuid, 'file UUID'),
      ) as EditLogRow[]
    return rows.map(toEditLogEntry)
  }

  clearEditLog(workspaceUuid: string, fileUuid: string): void {
    this.db
      .prepare('DELETE FROM edit_log WHERE workspace_uuid = ? AND file_uuid = ?')
      .run(requireId(workspaceUuid, 'workspace UUID'), requireId(fileUuid, 'file UUID'))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`[InternalStateStore] unknown session: ${sessionId}`)
    return session
  }
}

/**
 * Open (or create) the internal state store. Opening performs a one-time
 * integrity and schema check; any failure returns an explicit error instead of
 * throwing or silently starting empty, so the caller can degrade the same way
 * it does for a failed agent assembly while mindmap editing keeps working.
 */
export function openInternalStore(
  dbPath: string,
  options: InternalStoreOptions = {},
): OpenInternalStoreResult {
  if (!dbPath) {
    return { ok: false, error: 'Internal state store unavailable: database path is empty' }
  }

  let db: Database.Database | null = null
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const handle = new Database(dbPath)
    db = handle
    handle.pragma('foreign_keys = ON')

    let integrity: unknown
    try {
      integrity = handle.pragma('integrity_check', { simple: true })
    } catch (error) {
      throw new Error(`integrity check failed: ${describeError(error)}`, { cause: error })
    }
    if (integrity !== 'ok') {
      throw new Error(`integrity check failed: ${String(integrity)}`)
    }

    const version = Number(handle.pragma('user_version', { simple: true }))
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `schema version ${version} is newer than this app supports (${SCHEMA_VERSION})`,
      )
    }
    if (version < SCHEMA_VERSION) {
      handle.transaction(() => {
        handle.exec(SCHEMA_SQL)
        handle.pragma(`user_version = ${SCHEMA_VERSION}`)
      })()
    } else {
      assertSchemaComplete(handle)
    }

    return {
      ok: true,
      store: new SqliteInternalStateStore(handle, options.now ?? (() => new Date().toISOString())),
    }
  } catch (error) {
    db?.close()
    return {
      ok: false,
      error: `Internal state store unavailable at ${dbPath}: ${describeError(error)}`,
    }
  }
}
