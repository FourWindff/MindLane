import type { ChatStreamEvent } from './aiStore'
import type { ChatToolCall, DocumentRef } from '@/shared/lib/fileFormat'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'

/**
 * Remaining renderer-side duties for `end` events after live apply (ADR 0017
 * decision 3):
 * - `mindmapData` compatibility: when the legacy path still carries a full
 *   graph dump, feed it straight into the editor;
 * - `generatedDocumentRef` association: only when this turn had a write tool
 *   applied successfully (or mindmapData landed) do we attach the doc
 *   reference produced by the subgraph product, to avoid dangling references;
 * - generated-title backfill: the map title lands on the file it was generated for.
 * Batch persistence was removed — write tools are applied instantly through
 * the write responder during the stream; this module no longer touches editor
 * write operations.
 */
interface MindmapEndEffectsDependencies {
  /** Subscribe to stream events (returns an unsubscribe function). */
  subscribe: (listener: (event: ChatStreamEvent) => void) => () => void
  resolveFileUuid: (sessionId: string) => string | undefined
  getEditor: (fileUuid: string) => MindmapEditor | undefined
  /**
   * Backfills the title of the map produced this turn onto the file (entry
   * conversation: the eagerly created file starts with a placeholder title).
   */
  backfillTitle: (fileUuid: string, title: string) => void
}

/** The fixed 4 write tools (same name set as the write tools; decides whether this turn truly applied to disk). */
const WRITE_TOOL_NAMES = [
  'insertXmlFragment',
  'updateMindmapNode',
  'moveMindmapNode',
  'deleteMindmapNode',
]

/** Virtual tool the mindmap subgraph answers with; carries the generated title. */
const MINDMAP_SUBGRAPH_TOOL = 'generateMindmapFragment'

/** Whether the tool result is `{ok: true}` (write tool applied / subgraph product ok). */
function toolResultOk(result: string): boolean {
  try {
    const parsed = JSON.parse(result) as { ok?: unknown }
    return parsed.ok === true
  } catch {
    return false
  }
}

/** Title of the map the mindmap subgraph produced this turn ('' when it produced none). */
function generatedMapTitle(toolCalls: ChatToolCall[] | undefined): string {
  for (const toolCall of toolCalls ?? []) {
    if (toolCall.name !== MINDMAP_SUBGRAPH_TOOL) continue
    try {
      const result = JSON.parse(toolCall.result) as { ok?: unknown; title?: unknown }
      if (result.ok === true && typeof result.title === 'string' && result.title.trim()) {
        return result.title.trim()
      }
    } catch {
      // Unparseable subgraph result: nothing to backfill.
    }
  }
  return ''
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

        const title = generatedMapTitle(response.toolCalls)
        if (title) dependencies.backfillTitle(fileUuid, title)

        const appliedMindmapChange =
          Boolean(response.mindmapData) ||
          (response.toolCalls ?? []).some(
            (toolCall) => WRITE_TOOL_NAMES.includes(toolCall.name) && toolResultOk(toolCall.result),
          )
        if (!appliedMindmapChange) return

        for (const toolCall of response.toolCalls ?? []) {
          if (toolCall.name !== MINDMAP_SUBGRAPH_TOOL) continue
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
