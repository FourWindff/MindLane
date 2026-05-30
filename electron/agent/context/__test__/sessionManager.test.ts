import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SessionManager } from '../sessionManager.js'
import type { SessionMessage } from '../../db/chatDb.js'

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager()
    manager.init(':memory:')
    manager.setWorkspace('/workspace/test')
  })

  afterEach(() => {
    manager.close()
  })

  it('setWorkspace 计算正确的哈希', () => {
    expect(manager.workspacePath).toBe('/workspace/test')
    expect(manager.workspaceHash).toHaveLength(12)
    // MD5 of '/workspace/test' should be consistent
    const expectedHash = '1ba3970dc3ef' // precomputed md5('/workspace/test').slice(0,12)
    expect(manager.workspaceHash).toBe(expectedHash)
  })

  it('saveSession 保存会话元数据', async () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' },
    ]
    await manager.saveSession('session-1', messages)

    // Verify session metadata is saved
    const sessions = await manager.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('session-1')
    expect(sessions[0].messageCount).toBe(2)
  })

  it('saveSession 自动从第一条用户消息生成标题', async () => {
    const longMessage = 'This is a very long user message that should be truncated for the title'
    const messages: SessionMessage[] = [
      { role: 'user', content: longMessage, timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-title', messages)
    const sessions = await manager.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('This is a very long user messa...')
  })

  it('saveSession 更新时保留原有标题', async () => {
    const messages1: SessionMessage[] = [
      { role: 'user', content: 'First message', timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-preserve', messages1)

    const sessions1 = await manager.listSessions()
    const originalTitle = sessions1[0].title
    expect(originalTitle).toBe('First message')

    // Save again with more messages
    const messages2: SessionMessage[] = [
      { role: 'user', content: 'First message', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Response', timestamp: '2024-01-01T00:00:01Z' },
      { role: 'user', content: 'Second message', timestamp: '2024-01-01T00:00:02Z' },
    ]
    await manager.saveSession('session-preserve', messages2)

    const sessions2 = await manager.listSessions()
    expect(sessions2).toHaveLength(1)
    expect(sessions2[0].title).toBe(originalTitle)
  })

  it('listSessions 返回按 updatedAt 排序的结果', async () => {
    const messages1: SessionMessage[] = [
      { role: 'user', content: 'Msg 1', timestamp: '2024-01-01T00:00:00Z' },
    ]
    const messages2: SessionMessage[] = [
      { role: 'user', content: 'Msg 2', timestamp: '2024-01-02T00:00:00Z' },
    ]

    await manager.saveSession('session-older', messages1)
    // Small delay to ensure different updatedAt
    await new Promise((r) => setTimeout(r, 10))
    await manager.saveSession('session-newer', messages2)

    const sessions = await manager.listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions[0].id).toBe('session-newer')
    expect(sessions[1].id).toBe('session-older')
  })

  it('listSessions 支持分页', async () => {
    for (let i = 1; i <= 5; i++) {
      const messages: SessionMessage[] = [
        { role: 'user', content: `Message ${i}`, timestamp: `2024-01-0${i}T00:00:00Z` },
      ]
      await manager.saveSession(`session-${i}`, messages)
      if (i < 5) {
        await new Promise((r) => setTimeout(r, 10))
      }
    }

    const all = await manager.listSessions()
    expect(all).toHaveLength(5)

    const page1 = await manager.listSessions(2, 0)
    expect(page1).toHaveLength(2)
    expect(page1[0].id).toBe('session-5')
    expect(page1[1].id).toBe('session-4')

    const page2 = await manager.listSessions(2, 2)
    expect(page2).toHaveLength(2)
    expect(page2[0].id).toBe('session-3')
    expect(page2[1].id).toBe('session-2')
  })

  it('deleteSession 删除会话元数据', async () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-delete', messages)

    const sessionsBefore = await manager.listSessions()
    expect(sessionsBefore).toHaveLength(1)

    await manager.deleteSession('session-delete')

    const sessionsAfter = await manager.listSessions()
    expect(sessionsAfter).toHaveLength(0)
  })

  it('getMostRecentSessionId 返回最近更新的会话', async () => {
    const messages1: SessionMessage[] = [
      { role: 'user', content: 'Older', timestamp: '2024-01-01T00:00:00Z' },
    ]
    const messages2: SessionMessage[] = [
      { role: 'user', content: 'Newer', timestamp: '2024-01-02T00:00:00Z' },
    ]

    await manager.saveSession('session-older', messages1)
    await new Promise((r) => setTimeout(r, 10))
    await manager.saveSession('session-newer', messages2)

    const mostRecent = await manager.getMostRecentSessionId()
    expect(mostRecent).toBe('session-newer')
  })

  it('不同 workspace 的数据互相隔离', async () => {
    const messages1: SessionMessage[] = [
      { role: 'user', content: 'Workspace 1', timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-ws1', messages1)

    // Switch to workspace 2
    manager.setWorkspace('/workspace/other')
    const messages2: SessionMessage[] = [
      { role: 'user', content: 'Workspace 2', timestamp: '2024-01-01T00:00:00Z' },
    ]
    await manager.saveSession('session-ws2', messages2)

    // WS2 should only see its own session
    const ws2Sessions = await manager.listSessions()
    expect(ws2Sessions).toHaveLength(1)
    expect(ws2Sessions[0].title).toBe('Workspace 2')

    // Switch back to WS1
    manager.setWorkspace('/workspace/test')
    const ws1Sessions = await manager.listSessions()
    expect(ws1Sessions).toHaveLength(1)
    expect(ws1Sessions[0].title).toBe('Workspace 1')
  })

  it('loadHistory returns UI messages saved for the session', async () => {
    const messages: SessionMessage[] = [
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

    await manager.saveSession('session-ui-history', messages)

    await expect(manager.loadHistory('session-ui-history')).resolves.toEqual(messages)
  })

  it('saveSession appends only new frontend messages without rewriting existing history', async () => {
    await manager.saveSession('session-replace', [{ role: 'user', content: 'first' }])
    await manager.saveSession('session-replace', [
      { role: 'user', content: 'edited first' },
      { role: 'assistant', content: 'second' },
    ])

    await expect(manager.loadHistory('session-replace')).resolves.toEqual([
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

    await manager.saveSession('session-delete-linked', [{ role: 'user', content: 'delete me' }])
    await manager.deleteSession('session-delete-linked')

    await expect(manager.loadHistory('session-delete-linked')).resolves.toEqual([])
    expect(deletedThreads).toEqual(['session-delete-linked'])
  })

  it('loadHistoryAsMessages 无 checkpoint 时返回空', async () => {
    const loaded = await manager.loadHistoryAsMessages('non-existent-session')
    expect(loaded).toHaveLength(0)
  })
})
