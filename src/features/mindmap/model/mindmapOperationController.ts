import type { Connection, Edge, EdgeChange, Node, NodeChange, Viewport } from '@xyflow/react'
import type { MindmapEditor } from './mindmapEditor'
import type { MindmapStructureType } from './mindmapLayout'
import {
  collectSubtreeIds,
  findParentId,
  findRootNode,
  getChildIdsOrdered,
} from '@/shared/lib/mindmapTree'

type OperationEditor = Pick<
  MindmapEditor,
  | 'addChild'
  | 'addSibling'
  | 'deleteSubtrees'
  | 'applyNativeNodeChanges'
  | 'applyNativeEdgeChanges'
  | 'applyNativeConnect'
  | 'setNodeSelected'
  | 'setNodeEditing'
  | 'reset'
  | 'undo'
  | 'redo'
>

export interface MindmapOperationState {
  nodes: Node[]
  edges: Edge[]
  selectedId: string | null
  aiBusy: boolean
  structureType: MindmapStructureType
}

export interface MindmapFlowPort {
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
}

export function createMindmapOperationController({
  editor,
  getState,
  selection,
  flow,
}: MindmapOperationControllerDependencies) {
  const selectNode = (targetId: string) => {
    selection.setSelectedId(targetId)
    editor.setNodeSelected(targetId, true)
    flow.clearSelectionMode()
  }

  return {
    handleNodesChange(changes: NodeChange[]) {
      const state = getState()
      if (state.aiBusy) return
      editor.applyNativeNodeChanges(changes, state.structureType)
    },

    handleEdgesChange(changes: EdgeChange[]) {
      if (getState().aiBusy) return
      editor.applyNativeEdgeChanges(changes)
    },

    handleConnect(connection: Connection) {
      if (getState().aiBusy) return
      editor.applyNativeConnect(connection)
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

    addSibling() {
      const state = getState()
      if (state.aiBusy || !state.selectedId) return
      editor.addSibling(state.selectedId)
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

    reset() {
      if (getState().aiBusy) return
      editor.reset()
      selection.setSelectedId('root')
    },

    navigateLeft() {
      const state = getState()
      if (!state.selectedId) return
      const parentId = findParentId(state.edges, state.selectedId)
      if (parentId) selectNode(parentId)
    },

    navigateRight() {
      const state = getState()
      if (!state.selectedId) return
      const children = getChildIdsOrdered(state.nodes, state.edges, state.selectedId)
      if (children.length > 0) selectNode(children[0]!)
    },

    navigateUp() {
      const state = getState()
      if (!state.selectedId) return
      const parentId = findParentId(state.edges, state.selectedId)
      if (!parentId) return
      const siblings = getChildIdsOrdered(state.nodes, state.edges, parentId)
      const index = siblings.indexOf(state.selectedId)
      if (index > 0) selectNode(siblings[index - 1]!)
    },

    navigateDown() {
      const state = getState()
      if (!state.selectedId) return
      const parentId = findParentId(state.edges, state.selectedId)
      if (!parentId) return
      const siblings = getChildIdsOrdered(state.nodes, state.edges, parentId)
      const index = siblings.indexOf(state.selectedId)
      if (index >= 0 && index < siblings.length - 1) selectNode(siblings[index + 1]!)
    },

    async centerRoot() {
      const state = getState()
      const rootNode =
        flow.getNode('root') ??
        (() => {
          const root = findRootNode(state.nodes, state.edges)
          return root ? flow.getNode(root.id) : undefined
        })()
      if (!rootNode) return

      const width = rootNode.measured?.width ?? 160
      const height = rootNode.measured?.height ?? 40
      await flow.setCenter(rootNode.position.x + width / 2, rootNode.position.y + height / 2, {
        zoom: 1,
        duration: 300,
      })
      flow.persistViewport(flow.getViewport())
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
