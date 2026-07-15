import { describe, expect, it, vi } from 'vitest'
import { createMindmapToolCallRouter } from '../mindmapToolCallRouter'

describe('MindmapToolCallRouter', () => {
  it('applies end-event mindmap effects to the editor owning the session file', () => {
    let listener: ((event: never) => void) | undefined
    const editorA = {
      insertMindmapData: vi.fn(),
      addDocumentRef: vi.fn(),
    }
    const editorB = {
      insertMindmapData: vi.fn(),
      addDocumentRef: vi.fn(),
    }
    const handleToolCall = vi.fn(() => true)
    const router = createMindmapToolCallRouter({
      subscribe: (next) => {
        listener = next
        return () => undefined
      },
      resolveFileUuid: (sessionId) => (sessionId === 'session-a' ? 'file-a' : undefined),
      getEditor: (fileUuid) => (fileUuid === 'file-a' ? editorA : editorB),
      handleToolCall,
      persistFile: vi.fn(),
      actionToolNames: ['batchAddMindmapNodes'],
    })

    router.start()
    listener?.({
      streamId: 'stream-a',
      sessionId: 'session-a',
      type: 'end',
      payload: {
        content: 'done',
        mindmapData: { nodes: [], edges: [], title: 'A' },
        toolCalls: [
          {
            name: 'generateMindmapFragment',
            args: {},
            result: JSON.stringify({
              ok: true,
              documentRef: {
                id: 'doc-a',
                type: 'pdf',
                source: '/a.pdf',
                filename: 'a.pdf',
                importedAt: '2026-07-15T00:00:00.000Z',
              },
            }),
          },
          {
            name: 'batchAddMindmapNodes',
            args: {},
            result: JSON.stringify({ ok: true }),
          },
        ],
      },
    } as never)

    expect(editorA.insertMindmapData).toHaveBeenCalledTimes(1)
    expect(handleToolCall).toHaveBeenCalledWith(expect.anything(), editorA)
    expect(editorA.addDocumentRef).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-a' }))
    expect(editorB.insertMindmapData).not.toHaveBeenCalled()
  })

  it('does not receive stale end events rejected by the stream router', () => {
    const handleToolCall = vi.fn()
    const router = createMindmapToolCallRouter({
      subscribe: () => () => undefined,
      resolveFileUuid: () => 'file-a',
      getEditor: () => ({ insertMindmapData: vi.fn(), addDocumentRef: vi.fn() }),
      handleToolCall,
      persistFile: vi.fn(),
      actionToolNames: ['batchAddMindmapNodes'],
    })

    router.start()

    expect(handleToolCall).not.toHaveBeenCalled()
  })

  it('persists changes applied to a background file before it is reopened', () => {
    let listener: ((event: never) => void) | undefined
    const activeEditor = {
      insertMindmapData: vi.fn(),
      addDocumentRef: vi.fn(),
    }
    const backgroundEditor = {
      insertMindmapData: vi.fn(),
      addDocumentRef: vi.fn(),
    }
    const persistFile = vi.fn()
    const router = createMindmapToolCallRouter({
      subscribe: (next) => {
        listener = next
        return () => undefined
      },
      resolveFileUuid: () => 'file-b',
      getEditor: (fileUuid) => (fileUuid === 'file-b' ? backgroundEditor : activeEditor),
      handleToolCall: (_toolCall, editor) => {
        editor.insertMindmapData({ nodes: [], edges: [] })
        return true
      },
      persistFile,
      actionToolNames: ['batchAddMindmapNodes'],
    })

    router.start()
    listener?.({
      streamId: 'stream-b',
      sessionId: 'session-b',
      type: 'end',
      payload: {
        content: 'done',
        toolCalls: [
          {
            name: 'batchAddMindmapNodes',
            args: {},
            result: JSON.stringify({ ok: true }),
          },
        ],
      },
    } as never)

    expect(backgroundEditor.insertMindmapData).toHaveBeenCalledTimes(1)
    expect(activeEditor.insertMindmapData).not.toHaveBeenCalled()
    expect(persistFile).toHaveBeenCalledWith('file-b')
  })
})
