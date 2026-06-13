import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { SessionMessageStore, type SessionMeta } from '../sessionMessageStore.js'

describe('SessionMessageStore', () => {
  let store: SessionMessageStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'))
    store = new SessionMessageStore()
    await store.init(tmpDir)
    store.setWorkspace('ws1')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('空会话返回空消息列表', async () => {
    const messages = await store.loadMessages('new-session')
    expect(messages).toEqual([])
  })

  it('追加消息后元数据正确', async () => {
    await store.saveMessage('s1', new HumanMessage('hello'))
    await store.saveMessage('s1', new AIMessage('hi'))

    const messages = await store.loadMessages('s1')
    expect(messages).toHaveLength(2)
    expect(messages[0].getType()).toBe('human')
    expect(messages[1].getType()).toBe('ai')

    const sessions = await store.listSessions('ws1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('s1')
    expect(sessions[0].messageCount).toBe(2)
  })

  it('列出会话按 updatedAt 降序', async () => {
    await store.saveMessage('a', new HumanMessage('a'))
    await new Promise((r) => setTimeout(r, 20))
    await store.saveMessage('b', new HumanMessage('b'))

    const sessions = await store.listSessions('ws1')
    expect(sessions.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('不同工作区互相隔离', async () => {
    await store.saveMessage('s1', new HumanMessage('ws1 msg'))
    store.setWorkspace('ws2')
    await store.saveMessage('s2', new HumanMessage('ws2 msg'))

    const ws1 = await store.listSessions('ws1')
    const ws2 = await store.listSessions('ws2')
    expect(ws1.map((s) => s.id)).toEqual(['s1'])
    expect(ws2.map((s) => s.id)).toEqual(['s2'])
  })

  it('保存并读取含 lastConsolidated 与 _lastSummary 的元数据', async () => {
    const meta: SessionMeta = {
      id: 'meta-extra',
      title: 't',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      lastConsolidated: 5,
      _lastSummary: '用户讨论了技术栈选择',
    }
    await store.createSession('meta-extra', meta)

    const read = store.getSessionMeta('meta-extra')
    expect(read).toMatchObject({
      id: 'meta-extra',
      lastConsolidated: 5,
      _lastSummary: '用户讨论了技术栈选择',
    })

    const sessions = await store.listSessions('ws1')
    expect(sessions[0]).toMatchObject({
      lastConsolidated: 5,
      _lastSummary: '用户讨论了技术栈选择',
    })
  })

  it('删除会话后无法读取', async () => {
    await store.saveMessage('del', new HumanMessage('x'))
    await store.deleteSession('del')
    expect(await store.loadMessages('del')).toEqual([])
    expect(await store.listSessions('ws1')).toEqual([])
  })

  it('跳过损坏行并返回有效消息', async () => {
    const sessionPath = path.join(tmpDir, 'ws1', 'corrupt.jsonl')
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    const meta: SessionMeta = {
      id: 'corrupt',
      title: 't',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 2,
    }
    const goodLine = JSON.stringify({ type: 'human', data: { content: 'ok' } })
    fs.writeFileSync(sessionPath, `${JSON.stringify(meta)}\n${goodLine}\n{not valid json}\n`, 'utf-8')

    const messages = await store.loadMessages('corrupt')
    expect(messages).toHaveLength(1)
    expect(messages[0].getType()).toBe('human')
  })

  it('保存含 tool_calls 的助手消息后可正确加载', async () => {
    await store.saveMessage(
      'tool',
      new AIMessage({
        content: '使用工具',
        tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'x' } }],
      }),
    )
    await store.saveMessage(
      'tool',
      new ToolMessage({
        tool_call_id: 'call-1',
        name: 'search',
        content: 'result',
      }),
    )

    const messages = await store.loadMessages('tool')
    expect(messages).toHaveLength(2)
    expect(messages[0].getType()).toBe('ai')
    expect(messages[1].getType()).toBe('tool')
  })

  it('自动从旧版 SQLite app.db 迁移数据', async () => {
    const dbPath = path.join(tmpDir, 'app.db')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        workspace_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        message_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)

    const insertSession = db.prepare(
      'INSERT INTO chat_sessions (id, workspace_hash, title, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const insertMessage = db.prepare(
      'INSERT INTO chat_messages (session_id, seq, message_json, created_at) VALUES (?, ?, ?, ?)',
    )

    insertSession.run('mig-s1', 'ws1', 'Migrated Session', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', 2)
    insertMessage.run('mig-s1', 0, JSON.stringify({ role: 'user', content: 'hello', timestamp: '2024-01-01T00:00:00Z' }), '2024-01-01T00:00:00Z')
    insertMessage.run('mig-s1', 1, JSON.stringify({ role: 'assistant', content: 'hi', timestamp: '2024-01-01T00:00:01Z' }), '2024-01-01T00:00:01Z')
    db.close()

    const migrationStore = new SessionMessageStore()
    await migrationStore.init(tmpDir, { legacyDbPath: dbPath })

    const markerPath = path.join(tmpDir, '.migrated-to-jsonl')
    expect(fs.existsSync(markerPath)).toBe(true)
    expect(fs.existsSync(dbPath)).toBe(false)
    expect(fs.readdirSync(tmpDir).some((f) => f.startsWith('app.db.bak.'))).toBe(true)

    migrationStore.setWorkspace('ws1')
    const sessions = await migrationStore.listSessions('ws1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('mig-s1')
    expect(sessions[0].messageCount).toBe(2)

    const messages = await migrationStore.loadMessages('mig-s1')
    expect(messages).toHaveLength(2)
    expect(messages[0].getType()).toBe('human')
    expect(messages[1].getType()).toBe('ai')
  })
})
