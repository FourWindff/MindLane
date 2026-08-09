import type { ChatStreamEvent } from './aiStore'
import type { ChatToolCall, DocumentRef } from '@/shared/lib/fileFormat'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'

interface RouterDependencies {
  subscribe: (listener: (event: ChatStreamEvent) => void) => () => void
  resolveFileUuid: (sessionId: string) => string | undefined
  getEditor: (fileUuid: string) => MindmapEditor | undefined
  handleToolCall: (toolCall: ChatToolCall, editor: MindmapEditor) => boolean
  persistFile: (fileUuid: string) => void
  actionToolNames: readonly string[]
}

export function createMindmapToolCallRouter(dependencies: RouterDependencies) {
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
        let appliedMindmapChange = Boolean(response.mindmapData)
        let generatedDocumentRef: DocumentRef | null = null
        for (const toolCall of response.toolCalls ?? []) {
          if (toolCall.name === 'generateMindmapFragment') {
            try {
              const result = JSON.parse(toolCall.result) as {
                ok?: boolean
                documentRef?: DocumentRef | null
              }
              if (result.ok && result.documentRef) generatedDocumentRef = result.documentRef
            } catch {
              generatedDocumentRef = null
            }
          }
          if (dependencies.actionToolNames.includes(toolCall.name)) {
            appliedMindmapChange =
              dependencies.handleToolCall(toolCall, editor) || appliedMindmapChange
          }
        }
        if (generatedDocumentRef && appliedMindmapChange) {
          editor.addDocumentRef(generatedDocumentRef)
        }
        if (appliedMindmapChange) dependencies.persistFile(fileUuid)
      })
      return () => {
        unsubscribe?.()
        unsubscribe = null
      }
    },
  }
}
