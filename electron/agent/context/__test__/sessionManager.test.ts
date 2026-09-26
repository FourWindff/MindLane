import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { BaseMessage } from '@langchain/core/messages'
import { SessionManager } from '../sessionManager.js'
import { uiMessageToBaseMessages } from '../sessionMessageStore.js'
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

  /** 夹具：走 runner 同一条公共追加路径（UI 消息 → BaseMessage 落盘）。 */
  async function appendUiMessages(
    sessionId: string,
    messages: ChatMessage[],
    uuid: string = fileUuid,
  ): Promise<void> {
    const base: BaseMessage[] = []
    for (const message of messages) base.push(...uiMessageToBaseMessages(message))
    await manager.saveMessages(sessionId, base, uuid)
  }

  it('setWorkspace uses the stable workspace UUID for session storage', () => {
    expect(manager.workspacePath).toBe('/workspace/test')
    expect(manager.workspaceUuid).toBe('workspace-uuid-1')
  })

  it('appends UI messages and writes the session file metadata', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' },
    ]
    await appendUiMessages('session-1', messages)

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
    await appendUiMessages('session-a', [{ role: 'user', content: 'A' }], 'file-a')
    await appendUiMessages('session-b', [{ role: 'user', content: 'B' }], 'file-b')

    await expect(manager.listSessions({ fileUuid: 'file-a' })).resolves.toMatchObject([
      { id: 'session-a', fileUuid: 'file-a' },
    ])
    await expect(manager.listSessions({ fileUuid: 'file-b' })).resolves.toMatchObject([
      { id: 'session-b', fileUuid: 'file-b' },
    ])
  })

  it('listSessions 返回按 updatedAt 排序的结果', async () => {
    await appendUiMessages('session-older', [{ role: 'user', content: 'Msg 1' }])
    await new Promise((r) => setTimeout(r, 10))
    await appendUiMessages('session-newer', [{ role: 'user', content: 'Msg 2' }])

    const sessions = await manager.listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions[0].id).toBe('session-newer')
    expect(sessions[1].id).toBe('session-older')
  })

  it('listSessions 支持分页', async () => {
    for (let i = 1; i <= 5; i++) {
      await appendUiMessages(`session-${i}`, [{ role: 'user', content: `Message ${i}` }])
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

    const page3 = await manager.listSessions({ limit: 2, offset: 4 })
    expect(page3).toHaveLength(1)
    expect(page3[0].id).toBe('session-1')
  })

  it('deleteSession 删除会话元数据', async () => {
    await appendUiMessages('session-delete', [{ role: 'user', content: 'Hello' }])

    const sessionsBefore = await manager.listSessions()
    expect(sessionsBefore).toHaveLength(1)

    await manager.deleteSession('session-delete')

    const sessionsAfter = await manager.listSessions()
    expect(sessionsAfter).toHaveLength(0)
  })

  it('不同 workspace 的数据互相隔离', async () => {
    await appendUiMessages('session-ws1', [{ role: 'user', content: 'Workspace 1' }])

    manager.setWorkspace('/workspace/other', 'workspace-uuid-2')
    await appendUiMessages('session-ws2', [{ role: 'user', content: 'Workspace 2' }])

    const ws2Sessions = await manager.listSessions()
    expect(ws2Sessions.map((session) => session.id)).toEqual(['session-ws2'])

    manager.setWorkspace('/workspace/test', 'workspace-uuid-1')
    const ws1Sessions = await manager.listSessions()
    expect(ws1Sessions.map((session) => session.id)).toEqual(['session-ws1'])
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
        toolCalls: [
          { name: 'batchAddMindmapNodes', args: { count: 1 }, result: 'ok', status: 'success' },
        ],
        timestamp: '2024-01-01T00:00:01Z',
      },
    ]

    await appendUiMessages('session-ui-history', messages)

    const loaded = await manager.loadSessionMessages('session-ui-history')
    expect(loaded).toEqual(messages)
  })

  it('round-trips subgraph tool steps through the append path', async () => {
    const steps = [
      { step: 'reading-doc' },
      { step: 'extracting', completed: 1, total: 2 },
      { step: 'finalizing' },
    ]
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '生成导图完成',
        toolCalls: [
          {
            name: 'generateMindmapFragment',
            args: {},
            result: '{"ok":true}',
            steps,
          },
        ],
      },
    ]

    await appendUiMessages('session-steps', messages)

    const loaded = await manager.loadSessionMessages('session-steps')
    expect(loaded[0]!.toolCalls![0]!.steps).toEqual(steps)
  })

  it('deleteSession removes UI messages and checkpoint thread', async () => {
    const deletedThreads: string[] = []
    manager.setCheckpointer({
      deleteThread: async (threadId: string) => {
        deletedThreads.push(threadId)
      },
    } as never)

    await appendUiMessages('session-delete-linked', [{ role: 'user', content: 'delete me' }])
    await manager.deleteSession('session-delete-linked')

    await expect(manager.loadSessionMessages('session-delete-linked')).resolves.toEqual([])
    expect(deletedThreads).toEqual(['session-delete-linked'])
  })

  it('loadSessionBaseMessages 无消息时返回空', async () => {
    const loaded = await manager.loadSessionBaseMessages('non-existent-session')
    expect(loaded).toHaveLength(0)
  })
})
