import { describe, expect, it, vi } from 'vitest'
import { createMindmapEndEffects } from '../mindmapEndEffects'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'

function stubEditor() {
  return {
    insertMindmapData: vi.fn(),
    addDocumentRef: vi.fn(),
  } as unknown as MindmapEditor
}

const DOC_REF = {
  id: 'doc-a',
  type: 'pdf',
  source: '/a.pdf',
  filename: 'a.pdf',
  importedAt: '2026-07-15T00:00:00.000Z',
}

function endEvent(overrides: Record<string, unknown> = {}) {
  return {
    streamId: 'stream-a',
    sessionId: 'session-a',
    type: 'end',
    payload: {
      content: 'done',
      ...overrides,
    },
  } as never
}

describe('MindmapEndEffects（即时落盘后的 end 残余职责）', () => {
  it('applies mindmapData compat and associates the generated document ref when a write tool persisted', () => {
    let listener: ((event: never) => void) | undefined
    const editor = stubEditor()
    const effects = createMindmapEndEffects({
      subscribe: (next) => {
        listener = next
        return () => undefined
      },
      resolveFileUuid: (sessionId) => (sessionId === 'session-a' ? 'file-a' : undefined),
      getEditor: (fileUuid) => (fileUuid === 'file-a' ? editor : undefined),
      backfillTitle: vi.fn(),
    })

    effects.start()
    listener?.(
      endEvent({
        mindmapData: { nodes: [], edges: [], title: 'A' },
        toolCalls: [
          {
            name: 'generateMindmapFragment',
            args: {},
            result: JSON.stringify({ ok: true, documentRef: DOC_REF }),
          },
          {
            name: 'insertXmlFragment',
            args: {},
            result: JSON.stringify({ ok: true, action: 'insertXmlFragment', data: {} }),
          },
        ],
      }),
    )

    expect(editor.insertMindmapData).toHaveBeenCalledTimes(1)
    expect(editor.addDocumentRef).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-a' }))
  })

  it('does not associate the document ref when no write tool actually persisted', () => {
    let listener: ((event: never) => void) | undefined
    const editor = stubEditor()
    const effects = createMindmapEndEffects({
      subscribe: (next) => {
        listener = next
        return () => undefined
      },
      resolveFileUuid: () => 'file-a',
      getEditor: () => editor,
      backfillTitle: vi.fn(),
    })

    effects.start()
    listener?.(
      endEvent({
        toolCalls: [
          {
            name: 'generateMindmapFragment',
            args: {},
            result: JSON.stringify({ ok: true, documentRef: DOC_REF }),
          },
          {
            name: 'insertXmlFragment',
            args: {},
            result: JSON.stringify({ ok: false, error: '[block_not_found] 节点不存在' }),
          },
        ],
      }),
    )

    expect(editor.addDocumentRef).not.toHaveBeenCalled()
    expect(editor.insertMindmapData).not.toHaveBeenCalled()
  })

  it('ignores non-end events and unparseable tool results', () => {
    let listener: ((event: never) => void) | undefined
    const editor = stubEditor()
    const effects = createMindmapEndEffects({
      subscribe: (next) => {
        listener = next
        return () => undefined
      },
      resolveFileUuid: () => 'file-a',
      getEditor: () => editor,
      backfillTitle: vi.fn(),
    })

    effects.start()
    listener?.({
      streamId: 'stream-a',
      sessionId: 'session-a',
      type: 'token',
      payload: 'x',
    } as never)
    listener?.(
      endEvent({
        toolCalls: [
          {
            name: 'insertXmlFragment',
            args: {},
            result: JSON.stringify({ ok: true }),
          },
          {
            name: 'generateMindmapFragment',
            args: {},
            result: 'not-json',
          },
        ],
      }),
    )

    expect(editor.addDocumentRef).not.toHaveBeenCalled()
    expect(editor.insertMindmapData).not.toHaveBeenCalled()
  })

  it('backfills the file title with the generated map title', () => {
    let listener: ((event: never) => void) | undefined
    const editor = stubEditor()
    const backfillTitle = vi.fn()
    const effects = createMindmapEndEffects({
      subscribe: (next) => {
        listener = next
        return () => undefined
      },
      resolveFileUuid: () => 'file-a',
      getEditor: () => editor,
      backfillTitle,
    })

    effects.start()
    listener?.(
      endEvent({
        toolCalls: [
          {
            name: 'generateMindmapFragment',
            args: {},
            result: JSON.stringify({ ok: true, title: 'Ruby 学习路线', documentRef: DOC_REF }),
          },
          {
            name: 'insertXmlFragment',
            args: {},
            result: JSON.stringify({ ok: true, action: 'insertXmlFragment', data: {} }),
          },
        ],
      }),
    )

    expect(backfillTitle).toHaveBeenCalledWith('file-a', 'Ruby 学习路线')
  })

  it('does not backfill a title when this turn produced no map', () => {
    let listener: ((event: never) => void) | undefined
    const editor = stubEditor()
    const backfillTitle = vi.fn()
    const effects = createMindmapEndEffects({
      subscribe: (next) => {
        listener = next
        return () => undefined
      },
      resolveFileUuid: () => 'file-a',
      getEditor: () => editor,
      backfillTitle,
    })

    effects.start()
    listener?.(endEvent({ content: '这份文档讲了三件事' }))

    expect(backfillTitle).not.toHaveBeenCalled()
  })
})
