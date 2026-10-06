import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { SessionMessageStore, type SessionMeta } from './sessionMessageStore.js'

describe('SessionMessageStore', () => {
  let store: SessionMessageStore
  let tmpDir: string
  const fileUuid = 'file-uuid-1'
  const workspaceUuid = 'ws1'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'))
    store = new SessionMessageStore()
    await store.init(tmpDir)
  })

  /** Production only enters the workspace context inside a run (Runner.run wraps runInWorkspace); tests enter it the same way. */
  const inWs = <T>(fn: () => T, ws: string = workspaceUuid): T => store.runInWorkspace(ws, fn)

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns an empty message list for an empty session', async () =>
    inWs(async () => {
      const messages = await store.loadMessages('new-session')
      expect(messages).toEqual([])
    }))

  it('metadata is correct after appending messages', async () =>
    inWs(async () => {
      await store.saveMessage('s1', new HumanMessage('hello'), 'file-uuid-1')
      await store.saveMessage('s1', new AIMessage('hi'), fileUuid)

      const messages = await store.loadMessages('s1')
      expect(messages).toHaveLength(2)
      expect(messages[0].getType()).toBe('human')
      expect(messages[1].getType()).toBe('ai')

      const sessions = await store.listSessions('ws1')
      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe('s1')
      expect(sessions[0].fileUuid).toBe('file-uuid-1')
      expect(sessions[0].messageCount).toBe(2)
    }))

  it('does not collapse repeated user messages with identical content', async () =>
    inWs(async () => {
      await store.saveMessage('repeat', new HumanMessage('same prompt'), fileUuid)
      await store.saveMessage('repeat', new HumanMessage('same prompt'), fileUuid)

      const messages = await store.loadMessages('repeat')
      expect(messages).toHaveLength(2)
    }))

  it('skips batch-leading messages already persisted by a concurrent write', async () =>
    inWs(async () => {
      await store.saveMessage('race', new HumanMessage('hello'), fileUuid)
      await store.saveMessages('race', [new HumanMessage('hello'), new AIMessage('hi')], fileUuid)

      const messages = await store.loadMessages('race')
      expect(messages.map((msg) => [msg.getType(), msg.content])).toEqual([
        ['human', 'hello'],
        ['ai', 'hi'],
      ])
    }))

  it('lists sessions by updatedAt descending', async () =>
    inWs(async () => {
      await store.saveMessage('a', new HumanMessage('a'), fileUuid)
      await new Promise((r) => setTimeout(r, 20))
      await store.saveMessage('b', new HumanMessage('b'), fileUuid)

      const sessions = await store.listSessions('ws1')
      expect(sessions.map((s) => s.id)).toEqual(['b', 'a'])
    }))

  it('different workspaces stay isolated', async () => {
    await inWs(() => store.saveMessage('s1', new HumanMessage('ws1 msg'), fileUuid))
    await inWs(() => store.saveMessage('s2', new HumanMessage('ws2 msg'), fileUuid), 'ws2')

    expect((await store.listSessions('ws1')).map((s) => s.id)).toEqual(['s1'])
    expect((await store.listSessions('ws2')).map((s) => s.id)).toEqual(['s2'])
  })

  it('keeps concurrent async workspace contexts isolated', async () => {
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 10))
    const first = inWs(async () => {
      await gate
      await store.saveMessage('same-session', new HumanMessage('from ws1'), fileUuid)
    })
    const second = inWs(
      () => store.saveMessage('same-session', new HumanMessage('from ws2'), fileUuid),
      'ws2',
    )

    await Promise.all([first, second])
    const fromWs1 = await inWs(() => store.loadMessages('same-session'))
    const fromWs2 = await inWs(() => store.loadMessages('same-session'), 'ws2')
    expect(fromWs1[0]?.content).toBe('from ws1')
    expect(fromWs2[0]?.content).toBe('from ws2')
  })

  it('fails loudly without a workspace context instead of silently falling back', async () => {
    expect(() => store.resolveSessionPath('s1')).toThrow(/missing workspace context/)
    await expect(store.loadMessages('s1')).rejects.toThrow(/missing workspace context/)
  })

  it('saves and reads metadata containing lastConsolidated and _lastSummary', async () =>
    inWs(async () => {
      const meta: SessionMeta = {
        id: 'meta-extra',
        fileUuid: 'file-uuid-1',
        title: 't',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
        lastConsolidated: 5,
        _lastSummary: 'the user discussed the tech stack choice',
      }
      await store.createSession('meta-extra', meta)

      const read = store.getSessionMeta('meta-extra')
      expect(read).toMatchObject({
        id: 'meta-extra',
        lastConsolidated: 5,
        _lastSummary: 'the user discussed the tech stack choice',
      })

      const sessions = await store.listSessions('ws1')
      expect(sessions[0]).toMatchObject({
        lastConsolidated: 5,
        _lastSummary: 'the user discussed the tech stack choice',
      })
    }))

  it('cannot read a session after deleting it', async () =>
    inWs(async () => {
      await store.saveMessage('del', new HumanMessage('x'), fileUuid)
      await store.deleteSession('del')
      expect(await store.loadMessages('del')).toEqual([])
      expect(await store.listSessions('ws1')).toEqual([])
    }))

  it('skips corrupt lines and returns valid messages', async () =>
    inWs(async () => {
      const sessionPath = path.join(tmpDir, 'ws1', 'corrupt.jsonl')
      fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
      const meta: SessionMeta = {
        id: 'corrupt',
        fileUuid: 'file-uuid-1',
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
    }))

  it('loads an assistant message with tool_calls correctly after saving', async () =>
    inWs(async () => {
      await store.saveMessage(
        'tool',
        new AIMessage({
          content: 'using a tool',
          tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'x' } }],
        }),
        fileUuid,
      )
      await store.saveMessage(
        'tool',
        new ToolMessage({
          tool_call_id: 'call-1',
          name: 'search',
          content: 'result',
        }),
        fileUuid,
      )

      const messages = await store.loadMessages('tool')
      expect(messages).toHaveLength(2)
      expect(messages[0].getType()).toBe('ai')
      expect(messages[1].getType()).toBe('tool')
    }))

  it('round-trips ToolMessage additional_kwargs.toolSteps through jsonl', async () =>
    inWs(async () => {
      await store.saveMessages(
        'steps',
        [
          new AIMessage({
            content: '',
            tool_calls: [{ id: 'sc1', name: 'generateMindmapFragment', args: {} }],
          }),
          new ToolMessage({
            tool_call_id: 'sc1',
            name: 'generateMindmapFragment',
            content: '{"ok":true}',
            additional_kwargs: {
              toolSteps: [
                { step: 'reading-doc' },
                { step: 'extracting', completed: 1, total: 2 },
                { step: 'finalizing' },
              ],
            },
          }),
        ],
        fileUuid,
      )

      const messages = await store.loadMessages('steps')
      const toolMsg = messages.find((m) => m.getType() === 'tool') as ToolMessage
      expect(toolMsg.additional_kwargs.toolSteps).toEqual([
        { step: 'reading-doc' },
        { step: 'extracting', completed: 1, total: 2 },
        { step: 'finalizing' },
      ])
    }))
})
