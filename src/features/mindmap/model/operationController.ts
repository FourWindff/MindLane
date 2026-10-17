import type { Edge, EdgeChange, Node, NodeChange, Viewport } from '@xyflow/react'
import type { MindmapEditor } from './editor'
import {
  collectSubtreeIds,
  findParentId,
  findRootNode,
  getChildIdsOrdered,
} from '@/features/mindmap/model/mindmapTree'
import { defaultNodeSize } from './layout/nodeSize'
import type { SiblingInsertMode } from './editor'

type OperationEditor = Pick<
  MindmapEditor,
  | 'addChild'
  | 'addSibling'
  | 'addParent'
  | 'deleteSubtrees'
  | 'deleteNodeKeepingChildren'
  | 'applyNativeNodeChanges'
  | 'applyNativeEdgeChanges'
  | 'setNodeSelected'
  | 'setNodeEditing'
  | 'setNodeCollapsed'
  | 'reset'
  | 'undo'
  | 'redo'
>

interface MindmapOperationState {
  nodes: Node[]
  edges: Edge[]
  selectedId: string | null
  aiBusy: boolean
}

interface MindmapFlowPort {
  getNode(id: string): Node | undefined
  setCenter(x: number, y: number, options: { zoom: number; duration: number }): Promise<unknown>
  getViewport(): Viewport
  persistViewport(viewport: Viewport): void
  clearSelectionMode(): void
}

interface MindmapSelectionPort {
  setSelectedId(id: string | null): void
  setSelectedTopicIds(ids: string[]): void
  setHasSelection(hasSelection: boolean): void
}

export interface MindmapOperationControllerDependencies {
  editor: OperationEditor
  getState(): MindmapOperationState
  selection: MindmapSelectionPort
  flow: MindmapFlowPort
  /** Last child entered per parent, kept for the app session (not per file). */
  lastChildByParent?: Map<string, string>
}

export function createMindmapOperationController({
  editor,
  getState,
  selection,
  flow,
  lastChildByParent = new Map<string, string>(),
}: MindmapOperationControllerDependencies) {
  const selectNode = (targetId: string) => {
    selection.setSelectedId(targetId)
    editor.setNodeSelected(targetId, true)
    flow.clearSelectionMode()
  }

  const centerNode = async (nodeId: string, zoom: number) => {
    const node = flow.getNode(nodeId)
    if (!node) return
    const size = defaultNodeSize(node.type)
    const width = node.measured?.width ?? size.width
    const height = node.measured?.height ?? size.height
    await flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom,
      duration: 300,
    })
    flow.persistViewport(flow.getViewport())
  }

  const navigateTo = (targetId: string) => {
    selectNode(targetId)
    void centerNode(targetId, flow.getViewport().zoom)
  }

  return {
    handleNodesChange(changes: NodeChange[]) {
      const state = getState()
      if (state.aiBusy) {
        // Read-only during an AI stream, but dimension measurements must still
        // land: without them freshly inserted nodes keep default sizes and
        // their edges connect at the wrong points until a later interaction
        // forces a re-measure. The dimension-triggered reflow is also what
        // spreads siblings after a fragment insert.
        editor.applyNativeNodeChanges(changes.filter((c) => c.type === 'dimensions'))
        return
      }
      editor.applyNativeNodeChanges(changes)
    },

    handleEdgesChange(changes: EdgeChange[]) {
      if (getState().aiBusy) return
      editor.applyNativeEdgeChanges(changes)
    },

    handleSelectionChange(selectedNodes: Node[]) {
      selection.setSelectedId(selectedNodes[0]?.id ?? null)
      selection.setSelectedTopicIds(
        selectedNodes.filter((node) => node.type === 'text').map((node) => node.id),
      )
      selection.setHasSelection(selectedNodes.length > 0)
    },

    startEditing(nodeId: string) {
      if (getState().aiBusy) return
      editor.setNodeEditing(nodeId, true)
    },

    addChild() {
      const state = getState()
      if (state.aiBusy) return
      editor.addChild(state.selectedId ?? 'root')
    },

    addSibling(mode: SiblingInsertMode = 'end') {
      const state = getState()
      if (state.aiBusy || !state.selectedId) return
      editor.addSibling(state.selectedId, undefined, mode)
    },

    addParent() {
      const state = getState()
      if (state.aiBusy || !state.selectedId) return
      editor.addParent(state.selectedId)
    },

    removeSelected() {
      const state = getState()
      if (state.aiBusy) return

      const targets = state.nodes.filter(
        (node) => node.selected && node.id !== 'root' && !node.data?.exiting,
      )
      if (targets.length === 0) return

      const deletedIds = new Set<string>()
      for (const target of targets) {
        for (const id of collectSubtreeIds(state.edges, target.id)) deletedIds.add(id)
      }

      const primaryId = targets[0]!.id
      const parentId = findParentId(state.edges, primaryId)
      let nextSelectedId = parentId ?? 'root'
      if (parentId) {
        const siblings = getChildIdsOrdered(state.nodes, state.edges, parentId)
        const surviving = siblings.find((id) => !deletedIds.has(id))
        if (surviving) nextSelectedId = surviving
      }
      if (deletedIds.has(nextSelectedId)) nextSelectedId = 'root'

      selectNode(nextSelectedId)
      editor.deleteSubtrees(targets.map((target) => target.id))
    },

    /**
     * Delete the node itself and promote its children to its parent (unlike
     * `removeSelected`, which deletes the whole subtree). Single selection only.
     */
    removeNodeOnly(nodeId: string) {
      const state = getState()
      if (state.aiBusy || nodeId === 'root') return
      if (!state.nodes.some((node) => node.id === nodeId && !node.data?.exiting)) return
      const parentId = findParentId(state.edges, nodeId)
      if (!parentId) return

      selectNode(parentId)
      editor.deleteNodeKeepingChildren(nodeId)
    },

    reset() {
      if (getState().aiBusy) return
      editor.reset()
      selection.setSelectedId('root')
    },

    navigateLeft() {
      const state = getState()
      if (!state.selectedId) return
      const parentId = findParentId(state.edges, state.selectedId)
      if (!parentId) return
      lastChildByParent.set(parentId, state.selectedId)
      navigateTo(parentId)
    },

    navigateRight() {
      const state = getState()
      if (!state.selectedId) return
      const parentId = state.selectedId
      const children = getChildIdsOrdered(state.nodes, state.edges, parentId)
      if (children.length === 0) return

      const parent = state.nodes.find((node) => node.id === parentId)
      if (parent?.data?.collapsed === true && !state.aiBusy) {
        editor.setNodeCollapsed(parentId, false)
      }

      const remembered = lastChildByParent.get(parentId)
      navigateTo(remembered && children.includes(remembered) ? remembered : children[0]!)
    },

    navigateUp() {
      const state = getState()
      if (!state.selectedId) return
      const parentId = findParentId(state.edges, state.selectedId)
      if (!parentId) return
      const siblings = getChildIdsOrdered(state.nodes, state.edges, parentId)
      const index = siblings.indexOf(state.selectedId)
      if (index > 0) navigateTo(siblings[index - 1]!)
    },

    navigateDown() {
      const state = getState()
      if (!state.selectedId) return
      const parentId = findParentId(state.edges, state.selectedId)
      if (!parentId) return
      const siblings = getChildIdsOrdered(state.nodes, state.edges, parentId)
      const index = siblings.indexOf(state.selectedId)
      if (index >= 0 && index < siblings.length - 1) navigateTo(siblings[index + 1]!)
    },

    async centerRoot() {
      const state = getState()
      const rootId = flow.getNode('root')?.id ?? findRootNode(state.nodes, state.edges)?.id
      if (!rootId) return
      await centerNode(rootId, 1)
    },

    undo() {
      if (!getState().aiBusy) editor.undo()
    },

    redo() {
      if (!getState().aiBusy) editor.redo()
    },
  }
}

export type MindmapOperationController = ReturnType<typeof createMindmapOperationController>
