import { describe, expect, it, vi } from 'vitest'
import { MindmapEditor } from '../mindmapEditor'
import { MindmapHistory } from '../mindmapHistory'
import { createMindmapStore } from '../mindmapStore'
import { createMindmapOperationController } from '../mindmapOperationController'

describe('MindmapOperationController integration', () => {
  it('keeps consecutive children attached to the selected parent', () => {
    const store = createMindmapStore()
    const editor = new MindmapEditor(store, new MindmapHistory())
    editor.newFile('测试')

    const rootId = store.getState().nodes[0]!.id
    const parentId = editor.addChild(rootId).nodeId
    editor.setNodeSelected(parentId, true)

    let selectedId: string | null = parentId
    const controller = createMindmapOperationController({
      editor,
      getState: () => ({
        nodes: store.getState().nodes,
        edges: store.getState().edges,
        selectedId,
        aiBusy: false,
        structureType: 'logic',
      }),
      selection: {
        setSelectedId: (id) => {
          selectedId = id
        },
        setSelectedTopicIds: vi.fn(),
        setHasSelection: vi.fn(),
      },
      flow: {
        getNode: vi.fn(),
        setCenter: vi.fn().mockResolvedValue(undefined),
        getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
        persistViewport: vi.fn(),
        clearSelectionMode: vi.fn(),
      },
    })

    controller.addChild()
    controller.handleSelectionChange(store.getState().nodes.filter((node) => node.selected))
    controller.addChild()

    const children = store.getState().edges.filter((edge) => edge.source === parentId)
    expect(children).toHaveLength(2)
  })
})
