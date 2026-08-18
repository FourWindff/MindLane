import type { ChatStreamEvent } from './aiStore'
import type { DocumentRef } from '@/shared/lib/fileFormat'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'

/**
 * 即时落盘后 `end` 事件的残余渲染层职责（ADR 0017 决策 3）：
 * - `mindmapData` 兼容处理（旧路径仍可能携带整图数据时直接灌入编辑器）；
 * - `generatedDocumentRef` 关联：本轮确有一次写工具落盘成功（或 mindmapData 落地）
 *   时才把子图产物关联的文档引用挂到编辑器，避免悬空引用。
 * 批量落盘逻辑已删除——写工具在流中经落盘应答器即时应用，这里不再触碰编辑器写操作。
 */
export interface MindmapEndEffectsDependencies {
  /** 订阅流事件（返回取消订阅函数）。 */
  subscribe: (listener: (event: ChatStreamEvent) => void) => () => void
  resolveFileUuid: (sessionId: string) => string | undefined
  getEditor: (fileUuid: string) => MindmapEditor | undefined
}

/** 固定 4 写工具（与写工具集同名清单，判断本轮是否真实落盘成功）。 */
const WRITE_TOOL_NAMES = [
  'insertXmlFragment',
  'updateMindmapNode',
  'moveMindmapNode',
  'deleteMindmapNode',
]

/** 工具结果是否 `{ok: true}`（写工具落盘成功 / 子图产物 ok）。 */
function toolResultOk(result: string): boolean {
  try {
    const parsed = JSON.parse(result) as { ok?: unknown }
    return parsed.ok === true
  } catch {
    return false
  }
}

export function createMindmapEndEffects(dependencies: MindmapEndEffectsDependencies) {
  let unsubscribe: (() => void) | null = null

  return {
    start(): () => void {
      unsubscribe?.()
      unsubscribe = dependencies.subscribe((event) => {
        if (event.type !== 'end') return
        const fileUuid = dependencies.resolveFileUuid(event.sessionId)
        if (!fileUuid) return
        const editor = dependencies.getEditor(fileUuid)
        if (!editor) return
        const response = event.payload

        if (response.mindmapData) editor.insertMindmapData(response.mindmapData)

        const appliedMindmapChange =
          Boolean(response.mindmapData) ||
          (response.toolCalls ?? []).some(
            (toolCall) => WRITE_TOOL_NAMES.includes(toolCall.name) && toolResultOk(toolCall.result),
          )
        if (!appliedMindmapChange) return

        for (const toolCall of response.toolCalls ?? []) {
          if (toolCall.name !== 'generateMindmapFragment') continue
          try {
            const result = JSON.parse(toolCall.result) as {
              ok?: boolean
              documentRef?: DocumentRef | null
            }
            if (result.ok && result.documentRef) {
              editor.addDocumentRef(result.documentRef)
            }
          } catch {
            // 无法解析的子图结果：忽略，不阻断后续 toolCalls。
          }
        }
      })
      return () => {
        unsubscribe?.()
        unsubscribe = null
      }
    },
  }
}
