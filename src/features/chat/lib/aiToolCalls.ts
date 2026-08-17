import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import type { ChatToolCall } from '@/shared/lib/fileFormat'
import { MindmapXmlError } from '@/shared/lib/mindmapXml'

type ToolCallResult = ChatToolCall

interface InsertXmlAction {
  xml: string
  parentId?: string
  position?: 'root' | 'child' | 'after' | 'before'
}

interface UpdateNodeAction {
  xml: string
  nodeId: string
}

interface MoveNodeAction {
  nodeId: string
  targetId: string
  position?: 'child' | 'after' | 'before'
}

interface DeleteNodeAction {
  nodeId: string
  confirmDeleteSubtree: boolean
}

/** 固定写工具集（PRD 6.1）：1 读 + 4 写，YAML 入口已废弃。 */
export const MINDMAP_ACTION_TOOLS = [
  'insertXmlFragment',
  'updateMindmapNode',
  'moveMindmapNode',
  'deleteMindmapNode',
] as const

function warnToolError(name: string, error: unknown): void {
  const message =
    error instanceof MindmapXmlError
      ? `[${error.code}] ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error)
  console.warn(`[AI Tool] ${name} 执行失败：${message}`)
}

export function handleMindmapToolCall(toolCall: ToolCallResult, editor: MindmapEditor): boolean {
  try {
    const result = JSON.parse(toolCall.result) as
      { ok: true; action: string; data: Record<string, unknown> } | { ok: false; error: string }

    if (!result.ok) {
      console.warn(`[AI Tool] ${toolCall.name} failed:`, result.error)
      return false
    }

    switch (result.action) {
      case 'insertXmlFragment': {
        const data = result.data as unknown as InsertXmlAction
        void editor
          .insertFromXml(data.xml, { parentId: data.parentId, position: data.position })
          .catch((err) => warnToolError(toolCall.name, err))
        return true
      }

      case 'updateMindmapNode': {
        const data = result.data as unknown as UpdateNodeAction
        void editor.replaceNodeFromXml(data.xml).catch((err) => warnToolError(toolCall.name, err))
        return true
      }

      case 'moveMindmapNode': {
        const data = result.data as unknown as MoveNodeAction
        editor.moveSubtree(data.nodeId, data.targetId, data.position ?? 'child')
        return true
      }

      case 'deleteNode': {
        const data = result.data as unknown as DeleteNodeAction
        if (data.nodeId === 'root') {
          console.warn('[AI Tool] deleteMindmapNode: root 不可删除')
          return false
        }
        if (!data.confirmDeleteSubtree) {
          console.warn('[AI Tool] Delete cancelled: user did not confirm')
          return false
        }
        editor.deleteSubtree(data.nodeId)
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
