import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { handleMindmapToolCall } from '../aiToolCalls'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'

function resetMindmapStore(nodes: Node[], edges: Edge[]) {
  useMindmapStore.setState({
    nodes,
    edges,
    currentFile: null,
    hasUnsavedChanges: false,
  })
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
    resetMindmapStore(nodes, edges)

    const handled = handleMindmapToolCall(
      {
        id: 'tool-call-1',
        name: 'deleteMindmapNode',
        input: '{}',
        result: JSON.stringify({
          ok: true,
          action: 'deleteNode',
          data: { nodeId: 'deleted', confirmDeleteSubtree: true },
        }),
      },
      useMindmapStore.getState(),
    )

    expect(handled).toBe(true)

    vi.advanceTimersByTime(300)

    const remainingNodes = useMindmapStore.getState().nodes
    expect(remainingNodes.map((node) => node.id)).toEqual(['root', 'first', 'last'])
    expect(remainingNodes.find((node) => node.id === 'first')?.position.y).toBe(-32)
    expect(remainingNodes.find((node) => node.id === 'last')?.position.y).toBe(32)
  })
})
