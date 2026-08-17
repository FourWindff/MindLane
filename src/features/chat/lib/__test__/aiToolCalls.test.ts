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
    expect(remainingNodes.find((node) => node.id === 'first')?.position.y).toBe(-26)
    expect(remainingNodes.find((node) => node.id === 'last')?.position.y).toBe(26)
  })
})

describe('XML 写工具执行', () => {
  it('insertXmlFragment inserts nested subtrees', async () => {
    const { editor, store } = createTestEditor()
    const handled = handleMindmapToolCall(
      {
        name: 'insertXmlFragment',
        args: {},
        result: JSON.stringify({
          ok: true,
          action: 'insertXmlFragment',
          data: {
            xml: `<node type="text" content="分支"><node type="text" content="子" /></node>`,
            parentId: 'root',
            position: 'child',
          },
        }),
      },
      editor,
    )
    expect(handled).toBe(true)
    // 等待异步解析落图
    await vi.waitFor(() => {
      expect(store.getState().nodes).toHaveLength(3)
    })
    expect(store.getState().edges).toHaveLength(2)
  })

  it('updateMindmapNode replaces node and subtree wholesale', async () => {
    const { editor, store } = createTestEditor()
    store.setState({
      nodes: [
        { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
        { id: 'n1', type: 'text', position: { x: 200, y: 0 }, data: { label: '旧' } },
        { id: 'n2', type: 'text', position: { x: 400, y: 0 }, data: { label: '旧子' } },
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'n1', type: 'mindmap' },
        { id: 'e2', source: 'n1', target: 'n2', type: 'mindmap' },
      ],
      dirty: true,
      filePath: '/x.mindlane',
      hasDocumentOpen: true,
    })

    const handled = handleMindmapToolCall(
      {
        name: 'updateMindmapNode',
        args: {},
        result: JSON.stringify({
          ok: true,
          action: 'updateMindmapNode',
          data: {
            xml: `<node id="n1" type="text" content="新内容"><node type="text" content="新子" /></node>`,
            nodeId: 'n1',
          },
        }),
      },
      editor,
    )
    expect(handled).toBe(true)
    await vi.waitFor(() => {
      const state = store.getState()
      expect(state.nodes).toHaveLength(3)
      const n1 = state.nodes.find((n) => n.id === 'n1')!
      expect((n1.data as { label: string }).label).toBe('新内容')
      const n2 = state.nodes.find((n) => n.id === 'n2')
      expect(n2).toBeUndefined() // 旧子树被整体替换
      const child = state.nodes.find((n) => (n.data as { label: string }).label === '新子')!
      expect(state.edges.find((e) => e.target === child.id)!.source).toBe('n1')
      // 单条历史：undo 还原旧树
      editor.undo()
      const after = store.getState()
      expect(after.nodes.find((n) => n.id === 'n2')).toBeDefined()
    })
  })

  it('moveMindmapNode re-parents the subtree', async () => {
    const { editor, store } = createTestEditor()
    store.setState({
      nodes: [
        { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
        { id: 'a', type: 'text', position: { x: 200, y: -50 }, data: { label: 'A' } },
        { id: 'b', type: 'text', position: { x: 200, y: 50 }, data: { label: 'B' } },
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'a', type: 'mindmap' },
        { id: 'e2', source: 'root', target: 'b', type: 'mindmap' },
      ],
      dirty: true,
      filePath: '/x.mindlane',
      hasDocumentOpen: true,
    })

    const handled = handleMindmapToolCall(
      {
        name: 'moveMindmapNode',
        args: {},
        result: JSON.stringify({
          ok: true,
          action: 'moveMindmapNode',
          data: { nodeId: 'a', targetId: 'b', position: 'child' },
        }),
      },
      editor,
    )
    expect(handled).toBe(true)
    const state = store.getState()
    expect(state.edges.find((e) => e.target === 'a')!.source).toBe('b')
  })

  it('reports XML validation failures without crashing', async () => {
    const { editor, store } = createTestEditor()
    const handled = handleMindmapToolCall(
      {
        name: 'insertXmlFragment',
        args: {},
        result: JSON.stringify({
          ok: true,
          action: 'insertXmlFragment',
          data: {
            xml: `<node id="root" type="text" content="x" />`,
            parentId: 'root',
          },
        }),
      },
      editor,
    )
    expect(handled).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(store.getState().nodes).toHaveLength(1) // 未产生部分挂载
  })
})
