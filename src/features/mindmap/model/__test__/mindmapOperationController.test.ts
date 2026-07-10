import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  createMindmapOperationController,
  type MindmapOperationControllerDependencies,
} from '../mindmapOperationController'

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

  beforeEach(() => {
    selectedId = 'a'
    editor = {
      addChild: vi.fn(),
      addSibling: vi.fn(),
      deleteSubtrees: vi.fn(),
      applyNativeNodeChanges: vi.fn(),
      applyNativeEdgeChanges: vi.fn(),
      applyNativeConnect: vi.fn(),
      setNodeSelected: vi.fn(),
      setNodeEditing: vi.fn(),
      reset: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    }
    setSelectedId = vi.fn((next: string | null) => {
      selectedId = next
    })
    clearSelectionMode = vi.fn()
  })

  function createController(overrides: { aiBusy?: boolean } = {}) {
    return createMindmapOperationController({
      editor,
      getState: () => ({
        nodes,
        edges,
        selectedId,
        aiBusy: overrides.aiBusy ?? false,
        structureType: 'logic',
      }),
      selection: {
        setSelectedId,
        setSelectedTopicIds: vi.fn(),
        setHasSelection: vi.fn(),
      },
      flow: {
        getNode: (id) => nodes.find((node) => node.id === id),
        setCenter: vi.fn().mockResolvedValue(undefined),
        getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
        persistViewport: vi.fn(),
        clearSelectionMode,
      },
    })
  }

  it('forwards ReactFlow changes through the editor seam', () => {
    const controller = createController()
    const nodeChanges = [{ id: 'a', type: 'select' as const, selected: true }]
    const edgeChanges = [{ id: 'root-a', type: 'select' as const, selected: true }]
    const connection = { source: 'a', target: 'b', sourceHandle: null, targetHandle: null }

    controller.handleNodesChange(nodeChanges)
    controller.handleEdgesChange(edgeChanges)
    controller.handleConnect(connection)

    expect(editor.applyNativeNodeChanges).toHaveBeenCalledWith(nodeChanges, 'logic')
    expect(editor.applyNativeEdgeChanges).toHaveBeenCalledWith(edgeChanges)
    expect(editor.applyNativeConnect).toHaveBeenCalledWith(connection)
  })

  it('selects a surviving sibling before deleting selected subtrees', () => {
    const controller = createController()

    controller.removeSelected()

    expect(setSelectedId).toHaveBeenCalledWith('b')
    expect(editor.setNodeSelected).toHaveBeenCalledWith('b', true)
    expect(clearSelectionMode).toHaveBeenCalledOnce()
    expect(editor.deleteSubtrees).toHaveBeenCalledWith(['a'])
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
    controller.undo()
    controller.redo()

    expect(editor.addChild).not.toHaveBeenCalled()
    expect(editor.addSibling).not.toHaveBeenCalled()
    expect(editor.deleteSubtrees).not.toHaveBeenCalled()
    expect(editor.undo).not.toHaveBeenCalled()
    expect(editor.redo).not.toHaveBeenCalled()
  })
})
