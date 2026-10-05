import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { SessionManager } from '../sessionManager.js'

describe('SessionManager', () => {
  let manager: SessionManager
  let tmpDir: string
  const fileUuid = 'file-uuid-1'
  const workspaceUuid = 'workspace-uuid-1'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-manager-'))
    manager = new SessionManager()
    await manager.init(tmpDir)
  })

  /** Production only enters the workspace context inside a run (Runner.run wraps runInWorkspace); tests enter it the same way. */
  const inWs = <T>(fn: () => T, ws: string = workspaceUuid): T => manager.runInWorkspace(ws, fn)

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /** Fixture: uses the same shared append path as the runner (BaseMessage[] on disk). */
  const appendMessages = (
    sessionId: string,
    messages: BaseMessage[],
    uuid: string = fileUuid,
  ): Promise<void> => manager.saveMessages(sessionId, messages, uuid)

  it('appends UI messages and writes the session file metadata', async () =>
    inWs(async () => {
      await appendMessages('session-1', [
        new HumanMessage({
          content: 'Hello',
          response_metadata: { timestamp: '2024-01-01T00:00:00Z' },
        }),
        new AIMessage({
          content: 'Hi there',
          response_metadata: { timestamp: '2024-01-01T00:00:01Z' },
        }),
      ])

      const sessions = await manager.listSessions({ fileUuid: 'file-uuid-1' })
      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe('session-1')
      expect(sessions[0].fileUuid).toBe('file-uuid-1')
      expect(sessions[0].messageCount).toBe(2)
      expect(
        fs.existsSync(
          path.join(tmpDir, 'memory', 'sessions', 'workspace-uuid-1', 'session-1.jsonl'),
        ),
      ).toBe(true)
    }))

  it('listSessions returns only sessions bound to the requested file UUID', async () =>
    inWs(async () => {
      await appendMessages('session-a', [new HumanMessage('A')], 'file-a')
      await appendMessages('session-b', [new HumanMessage('B')], 'file-b')

      await expect(manager.listSessions({ fileUuid: 'file-a' })).resolves.toMatchObject([
        { id: 'session-a', fileUuid: 'file-a' },
      ])
      await expect(manager.listSessions({ fileUuid: 'file-b' })).resolves.toMatchObject([
        { id: 'session-b', fileUuid: 'file-b' },
      ])
    }))

  it('listSessions returns results sorted by updatedAt', async () =>
    inWs(async () => {
      await appendMessages('session-older', [new HumanMessage('Msg 1')])
      await new Promise((r) => setTimeout(r, 10))
      await appendMessages('session-newer', [new HumanMessage('Msg 2')])

      const sessions = await manager.listSessions()
      expect(sessions).toHaveLength(2)
      expect(sessions[0].id).toBe('session-newer')
      expect(sessions[1].id).toBe('session-older')
    }))

  it('listSessions supports pagination', async () =>
    inWs(async () => {
      for (let i = 1; i <= 5; i++) {
        await appendMessages(`session-${i}`, [new HumanMessage(`Message ${i}`)])
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
    }))

  it('deleteSession removes session metadata', async () =>
    inWs(async () => {
      await appendMessages('session-delete', [new HumanMessage('Hello')])

      const sessionsBefore = await manager.listSessions()
      expect(sessionsBefore).toHaveLength(1)

      await manager.deleteSession('session-delete')

      const sessionsAfter = await manager.listSessions()
      expect(sessionsAfter).toHaveLength(0)
    }))

  it('data in different workspaces stays isolated', async () => {
    await inWs(async () => {
      await appendMessages('session-ws1', [new HumanMessage('Workspace 1')])
    })
    await inWs(async () => {
      await appendMessages('session-ws2', [new HumanMessage('Workspace 2')])
    }, 'workspace-uuid-2')

    const ws1Sessions = await inWs(() => manager.listSessions())
    expect(ws1Sessions.map((session) => session.id)).toEqual(['session-ws1'])

    const ws2Sessions = await inWs(() => manager.listSessions(), 'workspace-uuid-2')
    expect(ws2Sessions.map((session) => session.id)).toEqual(['session-ws2'])
  })

  it('loadSessionMessages returns UI messages saved for the session', async () =>
    inWs(async () => {
      await appendMessages('session-ui-history', [
        new HumanMessage({
          content: 'Use this document',
          additional_kwargs: { attachment: { name: 'doc.pdf', type: 'pdf' } },
          response_metadata: { timestamp: '2024-01-01T00:00:00Z' },
        }),
        new AIMessage({
          content: 'Done',
          tool_calls: [{ name: 'batchAddMindmapNodes', args: { count: 1 }, id: 'call-0' }],
          response_metadata: { timestamp: '2024-01-01T00:00:01Z' },
        }),
        new ToolMessage({ tool_call_id: 'call-0', name: 'batchAddMindmapNodes', content: 'ok' }),
      ])

      const loaded = await manager.loadSessionMessages('session-ui-history')
      expect(loaded).toEqual([
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
      ])
    }))

  it('round-trips subgraph tool steps through the append path', async () =>
    inWs(async () => {
      const steps = [
        { step: 'reading-doc' },
        { step: 'extracting', completed: 1, total: 2 },
        { step: 'finalizing' },
      ]
      await appendMessages('session-steps', [
        new AIMessage({
          content: 'mindmap generation complete',
          tool_calls: [{ name: 'generateMindmapFragment', args: {}, id: 'call-0' }],
        }),
        new ToolMessage({
          tool_call_id: 'call-0',
          name: 'generateMindmapFragment',
          content: '{"ok":true}',
          additional_kwargs: { toolSteps: steps },
        }),
      ])

      const loaded = await manager.loadSessionMessages('session-steps')
      expect(loaded[0]!.toolCalls![0]!.steps).toEqual(steps)
    }))

  it('deleteSession removes UI messages and checkpoint thread', async () =>
    inWs(async () => {
      const deletedThreads: string[] = []
      manager.setCheckpointer({
        deleteThread: async (threadId: string) => {
          deletedThreads.push(threadId)
        },
      } as never)

      await appendMessages('session-delete-linked', [new HumanMessage('delete me')])
      await manager.deleteSession('session-delete-linked')

      await expect(manager.loadSessionMessages('session-delete-linked')).resolves.toEqual([])
      expect(deletedThreads).toEqual(['session-delete-linked'])
    }))

  it('loadSessionBaseMessages returns empty when there are no messages', async () =>
    inWs(async () => {
      const loaded = await manager.loadSessionBaseMessages('non-existent-session')
      expect(loaded).toHaveLength(0)
    }))
})
