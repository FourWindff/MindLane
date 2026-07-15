import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionManager } from '../sessionManager.js'
import type { ChatMessage } from '../../../../src/shared/lib/fileFormat.js'

describe('SessionManager', () => {
  let manager: SessionManager
  let tmpDir: string
  const fileUuid = 'file-uuid-1'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-manager-'))
    manager = new SessionManager()
    await manager.init(tmpDir)
    manager.setWorkspace('/workspace/test', 'workspace-uuid-1')
  })

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('setWorkspace uses the stable workspace UUID for session storage', () => {
    expect(manager.workspacePath).toBe('/workspace/test')
    expect(manager.workspaceUuid).toBe('workspace-uuid-1')
  })

  it('saveSession 保存会话元数据', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' },
    ]
    await manager.saveSession('session-1', messages, 'file-uuid-1')

    const sessions = await manager.listSessions({ fileUuid: 'file-uuid-1' })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('session-1')
    expect(sessions[0].fileUuid).toBe('file-uuid-1')
    expect(sessions[0].messageCount).toBe(2)
    expect(
      fs.existsSync(path.join(tmpDir, 'memory', 'sessions', 'workspace-uuid-1', 'session-1.jsonl')),
    ).toBe(true)
  })

  it('listSessions returns only sessions bound to the requested file UUID', async () => {
    await manager.saveSession('session-a', [{ role: 'user', content: 'A' }], 'file-a')
    await manager.saveSession('session-b', [{ role: 'user', content: 'B' }], 'file-b')

    await expect(manager.listSessions({ fileUuid: 'file-a' })).resolves.toMatchObject([
      { id: 'session-a', fileUuid: 'file-a' },
    ])
    await expect(manager.listSessions({ fileUuid: 'file-b' })).resolves.toMatchObject([
      { id: 'session-b', fileUuid: 'file-b' },
    ])
  })

  it('saveSession 更新时保留 lastConsolidated 与 _lastSummary', async () => {
    await manager.saveSession(
      'session-preserve-extra',
      [{ role: 'user', content: 'first' }],
      fileUuid,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (manager as any).store as import('../sessionMessageStore.js').SessionMessageStore
    await store.updateSessionMeta('session-preserve-extra', {
      ...(await store.getSessionMeta('session-preserve-extra'))!,
      lastConsolidated: 3,
      _lastSummary: 'summary',
    })

    await manager.saveSession(
      'session-preserve-extra',
      [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
      ],
      fileUuid,
    )

    const meta = await store.getSessionMeta('session-preserve-extra')
    expect(meta?.lastConsolidated).toBe(3)
    expect(meta?._lastSummary).toBe('summary')
  })

  it('saveSession 自动从第一条用户消息生成标题', async () => {
    const longMessage = 'This is a very long user message that should be truncated for the title'
    const messages: ChatMessage[] = [
      { role: 'user', content: longMessage, timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-title', messages, fileUuid)
    const sessions = await manager.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('This is a very long user messa...')
  })

  it('saveSession 更新时保留原有标题', async () => {
    const messages1: ChatMessage[] = [
      { role: 'user', content: 'First message', timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-preserve', messages1, fileUuid)

    const sessions1 = await manager.listSessions()
    const originalTitle = sessions1[0].title
    expect(originalTitle).toBe('First message')

    const messages2: ChatMessage[] = [
      { role: 'user', content: 'First message', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Response', timestamp: '2024-01-01T00:00:01Z' },
      { role: 'user', content: 'Second message', timestamp: '2024-01-01T00:00:02Z' },
    ]
    await manager.saveSession('session-preserve', messages2, fileUuid)

    const sessions2 = await manager.listSessions()
    expect(sessions2).toHaveLength(1)
    expect(sessions2[0].title).toBe(originalTitle)
  })

  it('listSessions 返回按 updatedAt 排序的结果', async () => {
    const messages1: ChatMessage[] = [
      { role: 'user', content: 'Msg 1', timestamp: '2024-01-01T00:00:00Z' },
    ]
    const messages2: ChatMessage[] = [
      { role: 'user', content: 'Msg 2', timestamp: '2024-01-02T00:00:00Z' },
    ]

    await manager.saveSession('session-older', messages1, fileUuid)
    await new Promise((r) => setTimeout(r, 10))
    await manager.saveSession('session-newer', messages2, fileUuid)

    const sessions = await manager.listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions[0].id).toBe('session-newer')
    expect(sessions[1].id).toBe('session-older')
  })

  it('listSessions 支持分页', async () => {
    for (let i = 1; i <= 5; i++) {
      const messages: ChatMessage[] = [
        { role: 'user', content: `Message ${i}`, timestamp: `2024-01-0${i}T00:00:00Z` },
      ]
      await manager.saveSession(`session-${i}`, messages, fileUuid)
      if (i < 5) {
        await new Promise((r) => setTimeout(r, 10))
      }
    }

    const all = await manager.listSessions()
    expect(all).toHaveLength(5)

    const page1 = await manager.listSessions({ limit: 2, offset: 0 })
    expect(page1).toHaveLength(2)
    expect(page1[0].id).toBe('session-5')
    expect(page1[1].id).toBe('session-4')

    const page2 = await manager.listSessions({ limit: 2, offset: 2 })
    expect(page2).toHaveLength(2)
    expect(page2[0].id).toBe('session-3')
    expect(page2[1].id).toBe('session-2')
  })

  it('deleteSession 删除会话元数据', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-delete', messages, fileUuid)

    const sessionsBefore = await manager.listSessions()
    expect(sessionsBefore).toHaveLength(1)

    await manager.deleteSession('session-delete')

    const sessionsAfter = await manager.listSessions()
    expect(sessionsAfter).toHaveLength(0)
  })

  it('getMostRecentSessionId 返回最近更新的会话', async () => {
    const messages1: ChatMessage[] = [
      { role: 'user', content: 'Older', timestamp: '2024-01-01T00:00:00Z' },
    ]
    const messages2: ChatMessage[] = [
      { role: 'user', content: 'Newer', timestamp: '2024-01-02T00:00:00Z' },
    ]

    await manager.saveSession('session-older', messages1, fileUuid)
    await new Promise((r) => setTimeout(r, 10))
    await manager.saveSession('session-newer', messages2, fileUuid)

    const mostRecent = await manager.getMostRecentSessionId()
    expect(mostRecent).toBe('session-newer')
  })

  it('不同 workspace 的数据互相隔离', async () => {
    const messages1: ChatMessage[] = [
      { role: 'user', content: 'Workspace 1', timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-ws1', messages1, fileUuid)

    manager.setWorkspace('/workspace/other', 'workspace-uuid-2')
    const messages2: ChatMessage[] = [
      { role: 'user', content: 'Workspace 2', timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-ws2', messages2, fileUuid)

    const ws2Sessions = await manager.listSessions()
    expect(ws2Sessions).toHaveLength(1)
    expect(ws2Sessions[0].title).toBe('Workspace 2')

    manager.setWorkspace('/workspace/test', 'workspace-uuid-1')
    const ws1Sessions = await manager.listSessions()
    expect(ws1Sessions).toHaveLength(1)
    expect(ws1Sessions[0].title).toBe('Workspace 1')
  })

  it('loadSessionMessages returns UI messages saved for the session', async () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Use this document',
        attachment: { name: 'doc.pdf', type: 'pdf' },
        timestamp: '2024-01-01T00:00:00Z',
      },
      {
        role: 'assistant',
        content: 'Done',
        toolCalls: [{ name: 'batchAddMindmapNodes', args: { count: 1 }, result: 'ok' }],
        timestamp: '2024-01-01T00:00:01Z',
      },
    ]

    await manager.saveSession('session-ui-history', messages, fileUuid)

    const loaded = await manager.loadSessionMessages('session-ui-history')
    expect(loaded).toEqual(messages)
  })

  it('saveSession appends only new frontend messages without rewriting existing history', async () => {
    await manager.saveSession('session-replace', [{ role: 'user', content: 'first' }], fileUuid)
    await manager.saveSession(
      'session-replace',
      [
        { role: 'user', content: 'edited first' },
        { role: 'assistant', content: 'second' },
      ],
      fileUuid,
    )

    const loaded = await manager.loadSessionMessages('session-replace')
    expect(loaded).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ])
  })

  it('deleteSession removes UI messages and checkpoint thread', async () => {
    const deletedThreads: string[] = []
    manager.setCheckpointer({
      deleteThread: async (threadId: string) => {
        deletedThreads.push(threadId)
      },
    } as never)

    await manager.saveSession(
      'session-delete-linked',
      [{ role: 'user', content: 'delete me' }],
      fileUuid,
    )
    await manager.deleteSession('session-delete-linked')

    await expect(manager.loadSessionMessages('session-delete-linked')).resolves.toEqual([])
    expect(deletedThreads).toEqual(['session-delete-linked'])
  })

  it('loadSessionBaseMessages 无消息时返回空', async () => {
    const loaded = await manager.loadSessionBaseMessages('non-existent-session')
    expect(loaded).toHaveLength(0)
  })
})
