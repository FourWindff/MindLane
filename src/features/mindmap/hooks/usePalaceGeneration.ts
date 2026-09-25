import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import { selectChatReady, useSettingsStore } from '@/app/settings/model/settingsStore'
import { reportRendererError } from '@/shared/lib/reportRendererError'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import { insertPalacePlaceholder } from '@/features/chat/model/mindmapWriteResponder'
import { startPalaceRun } from '@/features/mindmap/model/palaceRun'
import { buildChatContext } from '@/features/chat/lib/buildChatContext'

/**
 * Manual palace generation (CONTEXT.md「触发面」): the user's gesture starts one
 * ephemeral graph run (see palaceRun.ts). The placeholder, its placement and the
 * landing all live in the write responder's `landPalace` action — the same
 * landing the AI trigger uses — so this hook only owns the UI gate, the turn
 * context and the run start.
 */
export function usePalaceGeneration({
  nodes,
  selectedId,
  editor,
}: {
  nodes: Node[]
  selectedId: string | null
  editor: MindmapEditor
}) {
  const aiBusy = useAiStore(selectCurrentChatBusy)
  const chatReady = useSettingsStore(selectChatReady)

  return useCallback(async () => {
    if (aiBusy) return

    const mindlane = typeof window !== 'undefined' ? window.mindlane : undefined
    if (!mindlane) {
      reportRendererError('IPC 通道不可用，请确认 Electron 环境')
      return
    }

    if (!chatReady) {
      reportRendererError('请先在右侧「设置」面板中配置 API Key 并选择模型')
      return
    }

    let selectedNodes = nodes
      .filter((node) => node.selected && node.type === 'text')
      .map((node) => ({ id: node.id, label: String(node.data?.label ?? '') }))
    if (selectedNodes.length === 0 && selectedId) {
      const target = nodes.find((node) => node.id === selectedId)
      if (target?.type === 'text') {
        selectedNodes = [{ id: target.id, label: String(target.data?.label ?? '') }]
      }
    }
    if (selectedNodes.length === 0) {
      reportRendererError('未选中任何主题节点')
      return
    }

    const selectedIdSet = new Set(selectedNodes.map((node) => node.id))
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
        selectedNodes: selectedNodes.map((node) => ({
          id: node.id,
          type: 'text' as const,
          label: node.label,
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
      reportRendererError(`宫殿生成启动失败：${started.error}`)
      settle()
    }
  }, [aiBusy, chatReady, editor, nodes, selectedId])
}
