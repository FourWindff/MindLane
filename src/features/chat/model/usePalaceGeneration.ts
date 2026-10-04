import { useCallback } from 'react'
import { selectCurrentChatBusy, useAiStore } from './aiStore'
import { selectChatReady, useSettingsStore } from '@/features/settings/model/settingsStore'
import { reportRendererError } from '@/shared/lib/reportRendererError'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { insertPalacePlaceholder } from './mindmapWriteResponder'
import { startPalaceRun } from '@/features/mindmap/model/palaceRun'
import { buildChatContext } from '@/features/chat/lib/buildChatContext'
import type { MindmapSelectedTopic } from '@/features/mindmap/hooks/useMindmapView'

/**
 * Manual palace generation (CONTEXT.md "trigger surface"): the user's gesture starts one
 * ephemeral graph run (see palaceRun.ts).
 *
 * The orchestration — turn context, placeholder, run start — lives in chat; the
 * mindmap UI only emits the topic selection through a callback wired by the
 * composition root. Placeholder insertion (`insertPalacePlaceholder`) and the
 * landing (`landPalace`) both stay in the write responder, shared with the AI
 * trigger, so this hook only owns the gates, the context and the run start.
 */
export function usePalaceGeneration(): (topics: MindmapSelectedTopic[]) => void {
  const aiBusy = useAiStore(selectCurrentChatBusy)
  const chatReady = useSettingsStore(selectChatReady)

  return useCallback(
    async (topics: MindmapSelectedTopic[]) => {
      if (aiBusy) return

      const mindlane = typeof window !== 'undefined' ? window.mindlane : undefined
      if (!mindlane) {
        reportRendererError('IPC channel unavailable; make sure you are running in Electron')
        return
      }

      if (!chatReady) {
        reportRendererError(
          'Configure an API Key and model in the Settings panel on the right first',
        )
        return
      }

      const editor = openFileRegistry.getActive()?.editor
      if (!editor) {
        reportRendererError('No file is open, cannot generate a memory palace')
        return
      }

      const selectedIdSet = new Set(topics.map((topic) => topic.id))
      const selectedIds = [...selectedIdSet]
      const { nodeId: palaceId } = insertPalacePlaceholder(editor, selectedIds)
      const rollback = () => {
        editor.undo()
        for (const id of selectedIdSet) editor.clearNodeFlag(id, 'processing')
      }
      const ai = useAiStore.getState()
      ai.setBusy(true)

      const fileUuid = editor.getState().fileUuid
      // Settling clears the run's own file flag: the user may have switched files
      // while the palace was generating.
      const settle = () => useAiStore.getState().setFileBusy(fileUuid, false)
      let started: { ok: true } | { ok: false; error: string }
      try {
        // The palace subgraph reads its input from the turn state's selection.
        const context = {
          ...buildChatContext(),
          selectedNodes: topics.map((topic) => ({
            id: topic.id,
            type: 'text' as const,
            label: topic.label,
          })),
        }
        started = await startPalaceRun({
          fileUuid,
          nodeId: palaceId,
          context,
          // The run itself never touches the chat history (that is the ephemeral
          // contract); settling only releases the busy flag.
          handlers: { settle },
        })
      } catch (error) {
        started = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (!started.ok) {
        rollback()
        reportRendererError(`Failed to start palace generation: ${started.error}`)
        settle()
      }
    },
    [aiBusy, chatReady],
  )
}
