import type { Node, Edge } from '@xyflow/react'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { nodeRegistry } from '@/features/mindmap/nodes'
import { CHILD_OFFSET_X, CHILD_GAP_Y, reflowChildren } from '@/shared/lib/mindmapTree'
import type { ChatToolCall } from '@/shared/lib/fileFormat'

type ToolCallResult = ChatToolCall

interface AddNodeAction {
  type: 'text' | 'palace'
  parentId?: string
  nodeData: Record<string, unknown>
}

interface UpdateNodeAction {
  nodeId: string
  nodeType: string
  changes: Record<string, unknown>
}

interface DeleteNodeAction {
  nodeId: string
  confirmDeleteSubtree: boolean
}

export const MINDMAP_ACTION_TOOLS = [
  'addTextNode',
  'addPalaceNode',
  'updateMindmapNode',
  'deleteMindmapNode',
  'batchAddMindmapNodes',
]

export function handleMindmapToolCall(
  toolCall: ToolCallResult,
  mindmapStore: ReturnType<typeof useMindmapStore.getState>
): boolean {
  try {
    const result = JSON.parse(toolCall.result) as
      | { ok: true; action: string; data: unknown }
      | { ok: false; error: string }

    if (!result.ok) {
      console.warn(`[AI Tool] ${toolCall.name} failed:`, result.error)
      return false
    }

    const nodes = mindmapStore.nodes
    const edges = mindmapStore.edges

    switch (result.action) {
      case 'addNode': {
        const data = result.data as AddNodeAction
        const { type, parentId, nodeData } = data

        let targetParentId = parentId
        if (!targetParentId) {
          const selectedNode = nodes.find((n) => n.selected)
          if (selectedNode) {
            targetParentId = selectedNode.id
          } else {
            const rootNode = nodes.find((n) => !edges.some((e) => e.target === n.id))
            targetParentId = rootNode?.id ?? 'root'
          }
        }

        const newNodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        const parentNode = nodes.find((n) => n.id === targetParentId)

        let position = { x: 0, y: 0 }
        if (parentNode) {
          const siblings = edges
            .filter((e) => e.source === targetParentId)
            .map((e) => nodes.find((n) => n.id === e.target))
            .filter(Boolean)

          const siblingCount = siblings.length
          position = {
            x: parentNode.position.x + CHILD_OFFSET_X,
            y: parentNode.position.y + siblingCount * (60 + CHILD_GAP_Y),
          }
        }

        const descriptor = nodeRegistry.get(type)
        const deserializedData = descriptor
          ? descriptor.deserialize(nodeData)
          : nodeData

        const newNode: Node = {
          id: newNodeId,
          type,
          position,
          data: { ...deserializedData, justAdded: true },
        }

        const newEdge: Edge = {
          id: `e_${targetParentId}_${newNodeId}`,
          source: targetParentId,
          target: newNodeId,
          type: 'mindmap',
          className: 'mindmap-edge',
        }

        mindmapStore.setNodes([...nodes, newNode])
        mindmapStore.setEdges([...edges, newEdge])
        return true
      }

      case 'updateNode': {
        const data = result.data as UpdateNodeAction
        const { nodeId, nodeType, changes } = data

        mindmapStore.setNodes(
          nodes.map((n) => {
            if (n.id !== nodeId) return n

            const mergedData = { ...n.data, ...changes }
            const descriptor = nodeRegistry.get(nodeType)
            return {
              ...n,
              data: descriptor
                ? descriptor.deserialize(mergedData)
                : mergedData,
            }
          })
        )
        return true
      }

      case 'deleteNode': {
        const data = result.data as DeleteNodeAction
        const { nodeId, confirmDeleteSubtree } = data

        if (!confirmDeleteSubtree) {
          console.warn('[AI Tool] Delete cancelled: user did not confirm')
          return false
        }

        const idsToDelete = new Set<string>([nodeId])
        const collectChildren = (parentId: string) => {
          edges
            .filter((e) => e.source === parentId)
            .forEach((e) => {
              idsToDelete.add(e.target)
              collectChildren(e.target)
            })
        }
        collectChildren(nodeId)

        mindmapStore.setNodes(
          nodes.map((n) =>
            idsToDelete.has(n.id)
              ? { ...n, data: { ...n.data, exiting: true } }
              : n
          )
        )

        setTimeout(() => {
          const currentNodes = useMindmapStore.getState().nodes
          const currentEdges = useMindmapStore.getState().edges
          const nextNodes = currentNodes.filter((n) => !idsToDelete.has(n.id))
          const nextEdges = currentEdges.filter(
            (e) => !idsToDelete.has(e.source) && !idsToDelete.has(e.target)
          )
          const laidOut = reflowChildren('root', nextNodes, nextEdges, CHILD_OFFSET_X, CHILD_GAP_Y)

          useMindmapStore.getState().setNodes(laidOut)
          useMindmapStore.getState().setEdges(nextEdges)
        }, 300)

        return true
      }

      case 'batchAddNodes': {
        const { yamlFragment, parentId } = result.data as { yamlFragment: string; parentId?: string }

        if (!yamlFragment) {
          console.warn('[AI Tool] batchAddNodes: yamlFragment is empty')
          return false
        }

        mindmapStore.insertNodesFromYaml(yamlFragment, { parentId })
        return true
      }

      default:
        console.warn('[AI Tool] Unknown action:', result.action)
        return false
    }
  } catch (err) {
    console.error('[AI Tool] Failed to process tool call:', err)
    return false
  }
}
