import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

  it('insertMessage 和 getMessages', () => {
    db.upsertSession({
      id: 's1',
      workspace_hash: 'ws1',
      title: 'Session',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 2,
    })
    db.insertMessage({
      session_id: 's1',
      role: 'user',
      content: 'Hello',
      tool_calls: null,
      timestamp: '2024-01-01T00:00:01Z',
    })
    db.insertMessage({
      session_id: 's1',
      role: 'assistant',
      content: 'Hi there',
      tool_calls: JSON.stringify([
        { name: 'tool1', args: { key: 'value' }, result: 'done' },
      ]),
      timestamp: '2024-01-01T00:00:02Z',
    })
    const messages = db.getMessages('s1')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('Hello')
    expect(messages[0].tool_calls).toBeNull()
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('Hi there')
    expect(messages[1].tool_calls).toBe(
      JSON.stringify([{ name: 'tool1', args: { key: 'value' }, result: 'done' }]),
    )
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

  it('deleteSession 级联删除消息', () => {
    db.upsertSession({
      id: 's1',
      workspace_hash: 'ws1',
      title: 'Session',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      message_count: 1,
    })
    db.insertMessage({
      session_id: 's1',
      role: 'user',
      content: 'Hello',
      tool_calls: null,
      timestamp: '2024-01-01T00:00:00Z',
    })
    expect(db.getSession('s1')).toBeDefined()
    expect(db.getMessages('s1')).toHaveLength(1)

    db.deleteSession('s1')
    expect(db.getSession('s1')).toBeUndefined()
    expect(db.getMessages('s1')).toHaveLength(0)
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
})
