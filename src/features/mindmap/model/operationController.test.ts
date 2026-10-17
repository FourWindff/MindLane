import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  createMindmapOperationController,
  type MindmapOperationControllerDependencies,
} from './operationController'

describe('MindmapOperationController', () => {
  const nodes: Node[] = [
    { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    {
      id: 'a',
      type: 'text',
      position: { x: 200, y: -40 },
      data: { label: 'A' },
      selected: true,
    },
    { id: 'a-child', type: 'text', position: { x: 400, y: -40 }, data: { label: 'A1' } },
    { id: 'b', type: 'text', position: { x: 200, y: 40 }, data: { label: 'B' } },
  ]
  const edges: Edge[] = [
    { id: 'root-a', source: 'root', target: 'a' },
    { id: 'a-child', source: 'a', target: 'a-child' },
    { id: 'root-b', source: 'root', target: 'b' },
  ]

  let selectedId: string | null
  let editor: MindmapOperationControllerDependencies['editor']
  let setSelectedId: MindmapOperationControllerDependencies['selection']['setSelectedId']
  let clearSelectionMode: MindmapOperationControllerDependencies['flow']['clearSelectionMode']
  let setCenter: MindmapOperationControllerDependencies['flow']['setCenter']
  let persistViewport: MindmapOperationControllerDependencies['flow']['persistViewport']
  let viewportZoom: number
  let viewportX: number
  let viewportY: number

  beforeEach(() => {
    selectedId = 'a'
    viewportZoom = 1
    viewportX = 0
    viewportY = 0
    editor = {
      addChild: vi.fn(),
      addSibling: vi.fn(),
      addParent: vi.fn(),
      deleteSubtrees: vi.fn(),
      deleteNodeKeepingChildren: vi.fn(),
      applyNativeNodeChanges: vi.fn(),
      applyNativeEdgeChanges: vi.fn(),
      setNodeSelected: vi.fn(),
      setNodeEditing: vi.fn(),
      setNodeCollapsed: vi.fn(),
      reset: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    }
    setSelectedId = vi.fn((next: string | null) => {
      selectedId = next
    })
    clearSelectionMode = vi.fn()
    setCenter = vi.fn().mockResolvedValue(undefined)
    persistViewport = vi.fn()
  })

  function createController(
    overrides: {
      aiBusy?: boolean
      nodes?: Node[]
      edges?: Edge[]
      lastChildByParent?: Map<string, string>
    } = {},
  ) {
    return createMindmapOperationController({
      editor,
      getState: () => ({
        nodes: overrides.nodes ?? nodes,
        edges: overrides.edges ?? edges,
        selectedId,
        aiBusy: overrides.aiBusy ?? false,
      }),
      selection: {
        setSelectedId,
        setSelectedTopicIds: vi.fn(),
        setHasSelection: vi.fn(),
      },
      flow: {
        getNode: (id) => (overrides.nodes ?? nodes).find((node) => node.id === id),
        setCenter,
        getViewport: vi.fn(() => ({ x: viewportX, y: viewportY, zoom: viewportZoom })),
        persistViewport,
        clearSelectionMode,
      },
      lastChildByParent: overrides.lastChildByParent,
    })
  }

  it('forwards ReactFlow changes through the editor seam', () => {
    const controller = createController()
    const nodeChanges = [{ id: 'a', type: 'select' as const, selected: true }]
    const edgeChanges = [{ id: 'root-a', type: 'select' as const, selected: true }]

    controller.handleNodesChange(nodeChanges)
    controller.handleEdgesChange(edgeChanges)

    expect(editor.applyNativeNodeChanges).toHaveBeenCalledWith(nodeChanges)
    expect(editor.applyNativeEdgeChanges).toHaveBeenCalledWith(edgeChanges)
    // Pure-tree constraint: with every connect entry point removed, the controller no longer
    // exposes handleConnect
    expect((controller as Record<string, unknown>).handleConnect).toBeUndefined()
  })

  it('selects a surviving sibling before deleting selected subtrees', () => {
    const controller = createController()

    controller.removeSelected()

    expect(setSelectedId).toHaveBeenCalledWith('b')
    expect(editor.setNodeSelected).toHaveBeenCalledWith('b', true)
    expect(clearSelectionMode).toHaveBeenCalledOnce()
    expect(editor.deleteSubtrees).toHaveBeenCalledWith(['a'])
  })

  it('deletes a single node only: selects the parent first, then promotes through the editor', () => {
    const controller = createController()

    controller.removeNodeOnly('a-child')

    expect(setSelectedId).toHaveBeenCalledWith('a')
    expect(editor.setNodeSelected).toHaveBeenCalledWith('a', true)
    expect(clearSelectionMode).toHaveBeenCalledOnce()
    expect(editor.deleteNodeKeepingChildren).toHaveBeenCalledWith('a-child')
  })

  it('ignores delete-node-only for the root and for unknown nodes', () => {
    const controller = createController()

    controller.removeNodeOnly('root')
    controller.removeNodeOnly('missing')

    expect(editor.deleteNodeKeepingChildren).not.toHaveBeenCalled()
    expect(setSelectedId).not.toHaveBeenCalled()
  })

  it('navigates through the tree without ReactFlow mounted', () => {
    const controller = createController()

    controller.navigateLeft()
    expect(setSelectedId).toHaveBeenLastCalledWith('root')

    controller.navigateRight()
    expect(setSelectedId).toHaveBeenLastCalledWith('a')

    controller.navigateDown()
    expect(setSelectedId).toHaveBeenLastCalledWith('b')
  })

  it('blocks structural operations while AI is busy', () => {
    const controller = createController({ aiBusy: true })

    controller.addChild()
    controller.addSibling()
    controller.removeSelected()
    controller.removeNodeOnly('a')
    controller.undo()
    controller.redo()

    expect(editor.addChild).not.toHaveBeenCalled()
    expect(editor.addSibling).not.toHaveBeenCalled()
    expect(editor.deleteSubtrees).not.toHaveBeenCalled()
    expect(editor.deleteNodeKeepingChildren).not.toHaveBeenCalled()
    expect(editor.undo).not.toHaveBeenCalled()
    expect(editor.redo).not.toHaveBeenCalled()
  })

  it('forwards only dimension measurements to the editor while AI is busy', () => {
    const controller = createController({ aiBusy: true })

    controller.handleNodesChange([
      { id: 'a', type: 'dimensions' as const, dimensions: { width: 80, height: 30 } },
      { id: 'a', type: 'select' as const, selected: true },
      { id: 'a', type: 'position' as const, position: { x: 999, y: 999 } },
    ])

    // Dimensions keep flowing so freshly inserted nodes get measured and their
    // edges connect at real sizes mid-stream; interaction changes stay blocked.
    expect(editor.applyNativeNodeChanges).toHaveBeenCalledWith([
      { id: 'a', type: 'dimensions', dimensions: { width: 80, height: 30 } },
    ])
  })

  describe('keyboard navigation', () => {
    // P has two children ordered by y: `first` then `second`.
    const branchNodes: Node[] = [
      { id: 'p', type: 'text', position: { x: 0, y: 0 }, data: { label: 'P' } },
      { id: 'first', type: 'text', position: { x: 200, y: -80 }, data: { label: 'First' } },
      { id: 'second', type: 'text', position: { x: 200, y: 0 }, data: { label: 'Second' } },
    ]
    const branchEdges: Edge[] = [
      { id: 'p-first', source: 'p', target: 'first' },
      { id: 'p-second', source: 'p', target: 'second' },
    ]

    it('centers the selected node, keeping the current zoom', async () => {
      viewportZoom = 0.5
      const controller = createController()

      controller.navigateDown()

      expect(setCenter).toHaveBeenCalledWith(280, 60, { zoom: 0.5, duration: 300 })
      // The viewport is persisted once the centering animation resolves.
      await vi.waitFor(() => expect(persistViewport).toHaveBeenCalled())
    })

    it('returns to the child it left instead of the first one', () => {
      const lastChildByParent = new Map<string, string>()
      selectedId = 'second'
      const controller = createController({
        nodes: branchNodes,
        edges: branchEdges,
        lastChildByParent,
      })

      controller.navigateLeft()
      expect(setSelectedId).toHaveBeenLastCalledWith('p')

      controller.navigateRight()
      expect(setSelectedId).toHaveBeenLastCalledWith('second')
    })

    it('falls back to the first child when the remembered one is gone', () => {
      const lastChildByParent = new Map<string, string>([['p', 'second']])
      selectedId = 'p'
      const controller = createController({
        nodes: branchNodes.filter((node) => node.id !== 'second'),
        edges: branchEdges.filter((edge) => edge.target !== 'second'),
        lastChildByParent,
      })

      controller.navigateRight()

      expect(setSelectedId).toHaveBeenLastCalledWith('first')
    })

    it('expands a collapsed parent before entering it', () => {
      selectedId = 'a'
      const collapsedNodes = nodes.map((node) =>
        node.id === 'a' ? { ...node, data: { ...node.data, collapsed: true } } : node,
      )
      const controller = createController({ nodes: collapsedNodes })

      controller.navigateRight()

      expect(editor.setNodeCollapsed).toHaveBeenCalledWith('a', false)
      expect(setSelectedId).toHaveBeenLastCalledWith('a-child')
    })

    it('does not expand while AI is busy', () => {
      selectedId = 'a'
      const collapsedNodes = nodes.map((node) =>
        node.id === 'a' ? { ...node, data: { ...node.data, collapsed: true } } : node,
      )
      const controller = createController({ nodes: collapsedNodes, aiBusy: true })

      controller.navigateRight()

      expect(editor.setNodeCollapsed).not.toHaveBeenCalled()
    })
  })
})
