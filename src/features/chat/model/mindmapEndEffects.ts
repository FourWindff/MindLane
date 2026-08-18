import type { ChatStreamEvent } from './aiStore'
import type { DocumentRef } from '@/shared/lib/fileFormat'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'

/**
 * Remaining renderer-side duties for `end` events after live apply (ADR 0017
 * decision 3):
 * - `mindmapData` compatibility: when the legacy path still carries a full
 *   graph dump, feed it straight into the editor;
 * - `generatedDocumentRef` association: only when this turn had a write tool
 *   applied successfully (or mindmapData landed) do we attach the doc
 *   reference produced by the subgraph product, to avoid dangling references.
 * Batch persistence was removed — write tools are applied instantly through
 * the write responder during the stream; this module no longer touches editor
 * write operations.
 */
export interface MindmapEndEffectsDependencies {
  /** Subscribe to stream events (returns an unsubscribe function). */
  subscribe: (listener: (event: ChatStreamEvent) => void) => () => void
  resolveFileUuid: (sessionId: string) => string | undefined
  getEditor: (fileUuid: string) => MindmapEditor | undefined
}

/** The fixed 4 write tools (same name set as the write tools; decides whether this turn truly applied to disk). */
const WRITE_TOOL_NAMES = [
  'insertXmlFragment',
  'updateMindmapNode',
  'moveMindmapNode',
  'deleteMindmapNode',
]

/** Whether the tool result is `{ok: true}` (write tool applied / subgraph product ok). */
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
            // Unparseable subgraph result: ignore, do not block the remaining toolCalls.
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
