import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import {
  EDIT_LOG_MAX_ENTRIES,
  openInternalStore,
  type EditLogEntry,
  type InternalStateStore,
  type OpenInternalStoreResult,
} from './internalStore.js'

const WS = 'workspace-1'

/** Deterministic, monotonically increasing clock so ordering assertions never race. */
function createClock(): () => string {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
}

function expectOpened(result: OpenInternalStoreResult): InternalStateStore {
  if (!result.ok) throw new Error(result.error)
  return result.store
}

describe('InternalStateStore', () => {
  let tmpDir: string
  let dbPath: string
  let store: InternalStateStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-internal-store-'))
    dbPath = path.join(tmpDir, 'state.db')
    store = expectOpened(openInternalStore(dbPath, { now: createClock() }))
  })

  afterEach(() => {
    store.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function seedSession(sessionId: string, fileUuid: string, workspaceUuid = WS): void {
    store.createSession({
      sessionId,
      workspaceUuid,
      fileUuid,
      title: `title-${sessionId}`,
    })
  }

  it('lists sessions by updatedAt descending with pagination and file filtering', () => {
    seedSession('session-a', 'file-a')
    seedSession('session-b', 'file-b')
    seedSession('session-c', 'file-b')
    seedSession('other-workspace', 'file-x', 'workspace-2')

    expect(store.listSessions({ workspaceUuid: WS }).map((s) => s.sessionId)).toEqual([
      'session-c',
      'session-b',
      'session-a',
    ])
    expect(store.listSessions({ workspaceUuid: WS, limit: 2 }).map((s) => s.sessionId)).toEqual([
      'session-c',
      'session-b',
    ])
    expect(
      store.listSessions({ workspaceUuid: WS, limit: 2, offset: 2 }).map((s) => s.sessionId),
    ).toEqual(['session-a'])
    expect(
      store.listSessions({ workspaceUuid: WS, fileUuid: 'file-b' }).map((s) => s.sessionId),
    ).toEqual(['session-c', 'session-b'])
  })

  it('round-trips file identity: write, query, rename, query again, delete identity', () => {
    const originalPath = path.join(tmpDir, 'a.mindlane')
    const renamedPath = path.join(tmpDir, 'renamed.mindlane')
    fs.writeFileSync(originalPath, '<mindlane />')

    store.setFilePath(WS, 'file-a', originalPath)
    seedSession('session-a', 'file-a')
    store.setActiveSession(WS, 'file-a', 'session-a')

    expect(store.getFilePath(WS, 'file-a')).toBe(originalPath)
    expect(store.listSessions({ workspaceUuid: WS, fileUuid: 'file-a' })).toHaveLength(1)
    expect(store.getActiveSession(WS, 'file-a')).toBe('session-a')

    store.setFilePath(WS, 'file-a', renamedPath)
    store.setActiveSession(WS, 'file-a', 'session-a')

    expect(store.getFilePath(WS, 'file-a')).toBe(renamedPath)
    expect(store.listFilePaths(WS)).toEqual([
      { fileUuid: 'file-a', path: renamedPath, updatedAt: expect.any(String) },
    ])
    expect(
      store.listSessions({ workspaceUuid: WS, fileUuid: 'file-a' }).map((s) => s.sessionId),
    ).toEqual(['session-a'])

    store.deleteFileIdentity(WS, 'file-a')

    expect(store.getFilePath(WS, 'file-a')).toBeNull()
    expect(store.listFilePaths(WS)).toEqual([])
    expect(store.getActiveSession(WS, 'file-a')).toBeNull()
    expect(store.listActiveSessions(WS)).toEqual([])

    // Deleting a file identity keeps its sessions and never touches the .mindlane file.
    expect(store.getSession('session-a')).not.toBeNull()
    expect(
      store.listSessions({ workspaceUuid: WS, fileUuid: 'file-a' }).map((s) => s.sessionId),
    ).toEqual(['session-a'])
    expect(fs.existsSync(originalPath)).toBe(true)
    expect(fs.readFileSync(originalPath, 'utf-8')).toBe('<mindlane />')
  })

  it('moves a file path in one update and keeps its session and active mapping', () => {
    const originalPath = path.join(tmpDir, 'a.mindlane')
    const renamedPath = path.join(tmpDir, 'b.mindlane')
    store.setFilePath(WS, 'file-a', originalPath)
    seedSession('session-a', 'file-a')
    store.setActiveSession(WS, 'file-a', 'session-a')

    store.moveFilePath(originalPath, renamedPath)

    expect(store.getFilePath(WS, 'file-a')).toBe(renamedPath)
    expect(store.getActiveSession(WS, 'file-a')).toBe('session-a')
    expect(store.listSessions({ workspaceUuid: WS, fileUuid: 'file-a' })).toHaveLength(1)
  })

  it('moves every indexed path under a renamed folder and leaves lookalike paths alone', () => {
    const folder = path.join(tmpDir, 'notes')
    const movedFolder = path.join(tmpDir, 'archive')
    const lookalike = path.join(tmpDir, 'notes-2.mindlane')
    store.setFilePath(WS, 'file-a', path.join(folder, 'a.mindlane'))
    store.setFilePath(WS, 'file-b', path.join(folder, 'deep', 'b.mindlane'))
    store.setFilePath(WS, 'file-lookalike', lookalike)

    store.moveFilePath(folder, movedFolder)

    expect(
      store
        .listFilePaths(WS)
        .map((row) => row.path)
        .sort(),
    ).toEqual(
      [
        path.join(movedFolder, 'a.mindlane'),
        path.join(movedFolder, 'deep', 'b.mindlane'),
        lookalike,
      ].sort(),
    )
  })

  it('clears identity rows and active mappings at a deleted path, keeping sessions', () => {
    const deletedPath = path.join(tmpDir, 'gone.mindlane')
    const keptPath = path.join(tmpDir, 'kept.mindlane')
    store.setFilePath(WS, 'file-gone', deletedPath)
    store.setFilePath(WS, 'file-kept', keptPath)
    seedSession('session-gone', 'file-gone')
    seedSession('session-kept', 'file-kept')
    store.setActiveSession(WS, 'file-gone', 'session-gone')
    store.setActiveSession(WS, 'file-kept', 'session-kept')

    store.deleteFileIdentitiesAtPath(deletedPath)

    expect(store.getFilePath(WS, 'file-gone')).toBeNull()
    expect(store.getActiveSession(WS, 'file-gone')).toBeNull()
    expect(store.getFilePath(WS, 'file-kept')).toBe(keptPath)
    expect(store.getActiveSession(WS, 'file-kept')).toBe('session-kept')
    // The session data itself is retained: deleting a file never deletes conversation history.
    expect(store.getSession('session-gone')).not.toBeNull()
  })

  it('clears every identity under a deleted folder', () => {
    const folder = path.join(tmpDir, 'notes')
    const keptPath = path.join(tmpDir, 'kept.mindlane')
    store.setFilePath(WS, 'file-a', path.join(folder, 'a.mindlane'))
    store.setFilePath(WS, 'file-b', path.join(folder, 'deep', 'b.mindlane'))
    store.setFilePath(WS, 'file-kept', keptPath)
    store.setActiveSession(WS, 'file-a', 'session-a')
    store.setActiveSession(WS, 'file-b', 'session-b')
    store.setActiveSession(WS, 'file-kept', 'session-kept')

    store.deleteFileIdentitiesAtPath(folder)

    expect(store.listFilePaths(WS).map((row) => row.path)).toEqual([keptPath])
    expect(store.listActiveSessions(WS)).toEqual([
      { fileUuid: 'file-kept', sessionId: 'session-kept' },
    ])
  })

  it('lists capsule files with one query: sessions joined to their path, newest activity first', () => {
    store.setFilePath(WS, 'file-a', path.join(tmpDir, 'a.mindlane'))
    store.setFilePath(WS, 'file-b', path.join(tmpDir, 'b.mindlane'))
    // A path with no session and a session with no path both stay out: the query
    // only returns files that can be opened and have a conversation.
    store.setFilePath(WS, 'file-never-chatted', path.join(tmpDir, 'c.mindlane'))
    seedSession('session-a1', 'file-a')
    seedSession('session-b1', 'file-b')
    seedSession('session-orphan', 'file-orphan')
    store.appendMessages('session-a1', ['{"type":"human"}'])
    store.appendMessages('session-orphan', ['{"type":"human"}'])

    expect(store.listCapsuleFiles(WS)).toEqual([
      {
        fileUuid: 'file-a',
        filePath: path.join(tmpDir, 'a.mindlane'),
        lastActivityAt: expect.any(String),
      },
      {
        fileUuid: 'file-b',
        filePath: path.join(tmpDir, 'b.mindlane'),
        lastActivityAt: expect.any(String),
      },
    ])
  })

  it('stores messages as append-only rows in append order and keeps the session meta in step', () => {
    seedSession('session-a', 'file-a')

    store.appendMessages('session-a', ['{"type":"human"}', '{"type":"ai"}'])
    store.appendMessages('session-a', ['{"type":"tool"}'])

    const messages = store.loadMessages('session-a')
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3])
    expect(messages.map((m) => m.payload)).toEqual([
      '{"type":"human"}',
      '{"type":"ai"}',
      '{"type":"tool"}',
    ])
    expect(store.getSession('session-a')).toMatchObject({ messageCount: 3 })
  })

  it('rejects updates to stored message rows at the database level', () => {
    seedSession('session-a', 'file-a')
    store.appendMessages('session-a', ['{"type":"human"}'])
    store.close()

    const raw = new Database(dbPath)
    try {
      expect(() =>
        raw.prepare('UPDATE session_messages SET payload = ?').run('{"type":"ai"}'),
      ).toThrow(/append-only/i)
    } finally {
      raw.close()
    }
  })

  it('keeps the rolling summary and consolidation cursor next to the messages', () => {
    seedSession('session-a', 'file-a')
    store.appendMessages('session-a', ['{"type":"human"}', '{"type":"ai"}'])

    store.updateSessionMeta('session-a', {
      summary: 'the user picked a local-first storage approach',
      lastConsolidated: 2,
    })

    expect(store.getSession('session-a')).toMatchObject({
      summary: 'the user picked a local-first storage approach',
      lastConsolidated: 2,
      messageCount: 2,
    })
    expect(store.listSessions({ workspaceUuid: WS })[0]).toMatchObject({
      summary: 'the user picked a local-first storage approach',
      lastConsolidated: 2,
    })
    expect(store.loadMessages('session-a')).toHaveLength(2)
  })

  it('deletes a session together with its messages and active mappings', () => {
    seedSession('session-a', 'file-a')
    seedSession('session-b', 'file-b')
    store.appendMessages('session-a', ['{"type":"human"}'])
    store.setActiveSession(WS, 'file-a', 'session-a')
    store.setActiveSession(WS, 'file-b', 'session-b')

    store.deleteSession('session-a')

    expect(store.getSession('session-a')).toBeNull()
    expect(store.loadMessages('session-a')).toEqual([])
    expect(store.getActiveSession(WS, 'file-a')).toBeNull()
    expect(store.getActiveSession(WS, 'file-b')).toBe('session-b')
    expect(store.listSessions({ workspaceUuid: WS }).map((s) => s.sessionId)).toEqual(['session-b'])
  })

  it('appends, reads and clears the node edit log with a ring cap', () => {
    const first: EditLogEntry = { ts: 1, nodeId: 'n1', before: 'old', after: 'new' }
    store.appendEditLog(WS, 'file-a', first)
    store.appendEditLog(WS, 'file-a', { ts: 2, nodeId: 'n2', before: 'a', after: 'b' })

    expect(store.readEditLog(WS, 'file-a')).toEqual([
      first,
      { ts: 2, nodeId: 'n2', before: 'a', after: 'b' },
    ])

    for (let i = 0; i < EDIT_LOG_MAX_ENTRIES + 2; i++) {
      store.appendEditLog(WS, 'file-a', { ts: 100 + i, nodeId: 'n', before: 'x', after: 'y' })
    }
    const capped = store.readEditLog(WS, 'file-a')
    expect(capped).toHaveLength(EDIT_LOG_MAX_ENTRIES)
    expect(capped[capped.length - 1].ts).toBe(100 + EDIT_LOG_MAX_ENTRIES + 1)

    store.clearEditLog(WS, 'file-a')
    expect(store.readEditLog(WS, 'file-a')).toEqual([])
  })

  it('fails open with an explicit error on a corrupt database instead of throwing', () => {
    const corruptPath = path.join(tmpDir, 'corrupt.db')
    fs.writeFileSync(corruptPath, 'this is not a sqlite database')

    // Mindmap editing keeps working: the failure is contained to the store and never touches the file.
    const mindlanePath = path.join(tmpDir, 'untouched.mindlane')
    fs.writeFileSync(mindlanePath, '<mindlane><node id="root" /></mindlane>')

    let result: OpenInternalStoreResult | undefined
    expect(() => {
      result = openInternalStore(corruptPath)
    }).not.toThrow()

    expect(result?.ok).toBe(false)
    if (!result || result.ok) throw new Error('expected the corrupt store to fail')
    expect(result.error).toMatch(/integrity check failed/i)
    expect(result.error).toContain(corruptPath)
    expect(fs.readFileSync(mindlanePath, 'utf-8')).toBe('<mindlane><node id="root" /></mindlane>')
  })

  it('opens without probing any file-based session store', () => {
    expect(fs.existsSync(path.join(tmpDir, 'memory'))).toBe(false)
    expect(store.getSession('nothing-here')).toBeNull()
    expect(store.listSessions({ workspaceUuid: WS })).toEqual([])
  })

  it('derives readiness from the database alone, with no file-store existence probes', () => {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url))
    const source = fs.readFileSync(path.join(moduleDir, 'internalStore.ts'), 'utf-8')
    expect(source).not.toMatch(/\b(?:existsSync|statSync|accessSync|readdirSync|opendirSync)\b/)
  })

  it('refuses a schema newer than this app understands', () => {
    store.close()
    const raw = new Database(dbPath)
    raw.pragma('user_version = 999')
    raw.close()

    const result = openInternalStore(dbPath)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a newer schema to be rejected')
    expect(result.error).toMatch(/newer than this app supports/i)
  })

  it('refuses a schema whose tables are missing', () => {
    const incompletePath = path.join(tmpDir, 'incomplete.db')
    const raw = new Database(incompletePath)
    raw.pragma('user_version = 1')
    raw.close()

    const result = openInternalStore(incompletePath)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected an incomplete schema to be rejected')
    expect(result.error).toMatch(/schema is incomplete/i)
  })
})
