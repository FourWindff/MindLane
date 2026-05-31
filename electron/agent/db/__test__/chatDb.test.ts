import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ChatDb } from '../chatDb.js'

describe('ChatDb', () => {
  let db: ChatDb

  beforeEach(() => {
    db = new ChatDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('schema 初始化后表应存在', () => {
    db.upsertSession({
      id: 's1',
      workspace_hash: 'ws1',
      title: 'Test Session',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 0,
    })
    const session = db.getSession('s1')
    expect(session).toBeDefined()
    expect(session!.title).toBe('Test Session')
  })

  it('upsertSession 更新已有记录', () => {
    db.upsertSession({
      id: 's1',
      workspace_hash: 'ws1',
      title: 'Original Title',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 1,
    })
    db.upsertSession({
      id: 's1',
      workspace_hash: 'ws1',
      title: 'Updated Title',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      message_count: 3,
    })
    const session = db.getSession('s1')
    expect(session).toBeDefined()
    expect(session!.title).toBe('Updated Title')
    expect(session!.message_count).toBe(3)
    expect(session!.updated_at).toBe('2024-01-02T00:00:00Z')
  })

  it('listSessions 支持分页', () => {
    for (let i = 1; i <= 5; i++) {
      db.upsertSession({
        id: `s${i}`,
        workspace_hash: 'ws1',
        title: `Session ${i}`,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: `2024-01-0${i}T00:00:00Z`,
        message_count: 0,
      })
    }
    const all = db.listSessions('ws1')
    expect(all).toHaveLength(5)
    expect(all[0].id).toBe('s5')
    expect(all[4].id).toBe('s1')

    const page1 = db.listSessions('ws1', 2, 0)
    expect(page1).toHaveLength(2)
    expect(page1[0].id).toBe('s5')
    expect(page1[1].id).toBe('s4')

    const page2 = db.listSessions('ws1', 2, 2)
    expect(page2).toHaveLength(2)
    expect(page2[0].id).toBe('s3')
    expect(page2[1].id).toBe('s2')
  })

  it('deleteSession 只删除会话记录', () => {
    db.upsertSession({
      id: 's1',
      workspace_hash: 'ws1',
      title: 'Session',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 1,
    })
    expect(db.getSession('s1')).toBeDefined()

    db.deleteSession('s1')
    expect(db.getSession('s1')).toBeUndefined()
  })

  it('stores and loads UI chat messages in insertion order', () => {
    db.upsertSession({
      id: 's-msg',
      workspace_hash: 'ws1',
      title: 'Messages',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 0,
    })

    db.appendMessages('s-msg', [
      {
        role: 'user',
        content: 'Read this PDF',
        attachment: { name: 'notes.pdf', type: 'pdf' },
        timestamp: '2024-01-01T00:00:00Z',
      },
      {
        role: 'assistant',
        content: 'I created the mindmap.',
        toolCalls: [{ name: 'batchAddMindmapNodes', args: { count: 2 }, result: 'ok' }],
        timestamp: '2024-01-01T00:00:01Z',
      },
    ])

    expect(db.listMessages('s-msg')).toEqual([
      {
        role: 'user',
        content: 'Read this PDF',
        attachment: { name: 'notes.pdf', type: 'pdf' },
        timestamp: '2024-01-01T00:00:00Z',
      },
      {
        role: 'assistant',
        content: 'I created the mindmap.',
        toolCalls: [{ name: 'batchAddMindmapNodes', args: { count: 2 }, result: 'ok' }],
        timestamp: '2024-01-01T00:00:01Z',
      },
    ])
  })

  it('appendMessages is append-only for a session', () => {
    db.upsertSession({
      id: 's-append',
      workspace_hash: 'ws1',
      title: 'Append',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 0,
    })

    db.appendMessages('s-append', [{ role: 'user', content: 'first' }])
    db.appendMessages('s-append', [{ role: 'assistant', content: 'second' }])

    expect(db.listMessages('s-append')).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ])
  })

  it('deleteSession deletes stored UI messages', () => {
    db.upsertSession({
      id: 's-delete-messages',
      workspace_hash: 'ws1',
      title: 'Delete',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 1,
    })
    db.appendMessages('s-delete-messages', [{ role: 'user', content: 'remove me' }])

    db.deleteSession('s-delete-messages')

    expect(db.getSession('s-delete-messages')).toBeUndefined()
    expect(db.listMessages('s-delete-messages')).toEqual([])
  })

  it('getMostRecentSession 返回最近更新的会话', () => {
    db.upsertSession({
      id: 's1',
      workspace_hash: 'ws1',
      title: 'Older',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 0,
    })
    db.upsertSession({
      id: 's2',
      workspace_hash: 'ws1',
      title: 'Newer',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      message_count: 0,
    })
    const recent = db.getMostRecentSession('ws1')
    expect(recent).toBeDefined()
    expect(recent!.id).toBe('s2')
    expect(recent!.title).toBe('Newer')
  })

  it('listSessions 只返回指定 workspace 的会话', () => {
    db.upsertSession({
      id: 's1',
      workspace_hash: 'ws-a',
      title: 'Workspace A',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 0,
    })
    db.upsertSession({
      id: 's2',
      workspace_hash: 'ws-b',
      title: 'Workspace B',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 0,
    })
    const wsASessions = db.listSessions('ws-a')
    expect(wsASessions).toHaveLength(1)
    expect(wsASessions[0].id).toBe('s1')

    const wsBSessions = db.listSessions('ws-b')
    expect(wsBSessions).toHaveLength(1)
    expect(wsBSessions[0].id).toBe('s2')
  })

  it('rebuilds legacy chat_messages schema without message_json column', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindlane-chatdb-'))
    const dbPath = path.join(tempDir, 'legacy.db')
    const legacyDb = new Database(dbPath)
    legacyDb.exec(`
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    legacyDb.close()

    const migrated = new ChatDb(dbPath)
    migrated.upsertSession({
      id: 's-migrated',
      workspace_hash: 'ws1',
      title: 'Migrated',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 0,
    })
    migrated.appendMessages('s-migrated', [{ role: 'user', content: 'new schema' }])

    expect(migrated.listMessages('s-migrated')).toEqual([{ role: 'user', content: 'new schema' }])
    migrated.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
