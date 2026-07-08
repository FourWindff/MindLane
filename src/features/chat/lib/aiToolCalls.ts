import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
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

export function handleMindmapToolCall(toolCall: ToolCallResult, editor: MindmapEditor): boolean {
  try {
    const result = JSON.parse(toolCall.result) as
      { ok: true; action: string; data: unknown } | { ok: false; error: string }

    if (!result.ok) {
      console.warn(`[AI Tool] ${toolCall.name} failed:`, result.error)
      return false
    }

    switch (result.action) {
      case 'addNode': {
        const data = result.data as AddNodeAction
        const { type, parentId, nodeData } = data
        editor.addNode({ type, data: nodeData, parentId })
        return true
      }

      case 'updateNode': {
        const data = result.data as UpdateNodeAction
        const { nodeId, nodeType, changes } = data
        editor.updateNodeData(nodeId, nodeType, changes)
        return true
      }

      case 'deleteNode': {
        const data = result.data as DeleteNodeAction
        const { nodeId, confirmDeleteSubtree } = data

        if (!confirmDeleteSubtree) {
          console.warn('[AI Tool] Delete cancelled: user did not confirm')
          return false
        }

        editor.deleteSubtree(nodeId)
        return true
      }

      case 'batchAddNodes': {
        const { yamlFragment, parentId } = result.data as {
          yamlFragment: string
          parentId?: string
        }

        if (!yamlFragment) {
          console.warn('[AI Tool] batchAddNodes: yamlFragment is empty')
          return false
        }

        editor.insertFromYaml(yamlFragment, { parentId })
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
