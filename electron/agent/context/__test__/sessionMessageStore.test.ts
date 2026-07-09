import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
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

  it('跳过已经由并发写入持久化的批次开头消息', async () => {
    await store.saveMessage('race', new HumanMessage('hello'))
    await store.saveMessages('race', [new HumanMessage('hello'), new AIMessage('hi')])

    const messages = await store.loadMessages('race')
    expect(messages.map((msg) => [msg.getType(), msg.content])).toEqual([
      ['human', 'hello'],
      ['ai', 'hi'],
    ])
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
    fs.writeFileSync(
      sessionPath,
      `${JSON.stringify(meta)}\n${goodLine}\n{not valid json}\n`,
      'utf-8',
    )

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
})
