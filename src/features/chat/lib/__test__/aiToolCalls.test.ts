import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { handleMindmapToolCall } from '../aiToolCalls'
import { createMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import { MindmapHistory } from '@/features/mindmap/model/mindmapHistory'

function resetMindmapStore(
  store: ReturnType<typeof createMindmapStore>,
  nodes: Node[],
  edges: Edge[],
) {
  store.setState({
    nodes,
    edges,
    dirty: false,
    filePath: null,
    hasDocumentOpen: false,
  })
}

function createTestEditor() {
  const store = createMindmapStore()
  const history = new MindmapHistory()
  return { editor: new MindmapEditor(store, history), store }
}

describe('handleMindmapToolCall', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reflows the remaining tree after deleting a node', () => {
    vi.useFakeTimers()

    const nodes: Node[] = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
      { id: 'first', type: 'text', position: { x: 220, y: -64 }, data: { label: 'First' } },
      { id: 'deleted', type: 'text', position: { x: 220, y: 0 }, data: { label: 'Deleted' } },
      { id: 'last', type: 'text', position: { x: 220, y: 64 }, data: { label: 'Last' } },
    ]
    const edges: Edge[] = [
      { id: 'e-root-first', source: 'root', target: 'first', type: 'mindmap' },
      { id: 'e-root-deleted', source: 'root', target: 'deleted', type: 'mindmap' },
      { id: 'e-root-last', source: 'root', target: 'last', type: 'mindmap' },
    ]
    const { editor, store } = createTestEditor()
    resetMindmapStore(store, nodes, edges)

    const handled = handleMindmapToolCall(
      {
        name: 'deleteMindmapNode',
        args: {},
        result: JSON.stringify({
          ok: true,
          action: 'deleteNode',
          data: { nodeId: 'deleted', confirmDeleteSubtree: true },
        }),
      },
      editor,
    )

    expect(handled).toBe(true)

    vi.advanceTimersByTime(300)

    const remainingNodes = store.getState().nodes
    expect(remainingNodes.map((node) => node.id)).toEqual(['root', 'first', 'last'])
    expect(remainingNodes.find((node) => node.id === 'first')?.position.y).toBe(-32)
    expect(remainingNodes.find((node) => node.id === 'last')?.position.y).toBe(32)
  })
})
