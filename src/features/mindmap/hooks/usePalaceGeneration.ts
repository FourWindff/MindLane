import { useCallback } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import { selectChatReady, useSettingsStore } from '@/app/settings/model/settingsStore'
import { reportRendererError } from '@/shared/lib/reportRendererError'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import type { MindmapCommand } from '@/features/mindmap/model/types'
import { findParentId, newId } from '@/shared/lib/mindmapTree'
import { startPalaceRun } from '@/features/mindmap/model/palaceRun'
import { buildChatContext } from '@/features/chat/lib/buildChatContext'
import { VISUAL_VARIANTS } from '@/features/mindmap/style/presets'
import type { VisualVariant } from '@/features/mindmap/style/types'

/**
 * Manual palace generation (CONTEXT.md「触发面」): the user's gesture starts one
 * ephemeral graph run (see palaceRun.ts) instead of calling the palace subgraph
 * outside the graph. The placeholder node and the edge rewiring stay here; the
 * run's progress, resume entry and landing live in the palace run module.
 */
export function usePalaceGeneration({
  nodes,
  edges,
  selectedId,
  editor,
  visualVariant,
}: {
  nodes: Node[]
  edges: Edge[]
  selectedId: string | null
  editor: MindmapEditor
  visualVariant: VisualVariant
}) {
  const aiBusy = useAiStore(selectCurrentChatBusy)
  const chatReady = useSettingsStore(selectChatReady)

  return useCallback(async () => {
    if (aiBusy) return

    const ai = useAiStore.getState()
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

    const palaceId = newId()
    const parentId = findParentId(edges, selectedNodes[0]?.id ?? '') ?? 'root'
    const parentNode = nodes.find((node) => node.id === parentId)
    const firstSelected = nodes.find((node) => node.id === selectedNodes[0]?.id)
    const offsetX = VISUAL_VARIANTS[visualVariant].spacing.offsetX
    const placeholderNode: Node = {
      id: palaceId,
      type: 'palace',
      position: {
        x: firstSelected?.position.x ?? (parentNode?.position.x ?? 0) + offsetX,
        y: firstSelected?.position.y ?? parentNode?.position.y ?? 0,
      },
      data: {
        label: '生成中…',
        imageUrl: '',
        stations: [],
        sourceNodeIds: selectedNodes.map((node) => node.id),
        generating: true,
      },
    }
    const treeEdge: Edge = {
      id: `e-${parentId}-${palaceId}`,
      source: parentId,
      target: palaceId,
      type: 'mindmap',
      className: 'mindmap-edge',
    }
    const selectedIdSet = new Set(selectedNodes.map((node) => node.id))
    const rollback = () => {
      editor.undo()
      for (const id of selectedIdSet) editor.clearNodeFlag(id, 'processing')
    }
    const childEdges: Edge[] = selectedNodes.map((node) => ({
      id: `e-${palaceId}-${node.id}`,
      source: palaceId,
      target: node.id,
      type: 'mindmap',
      className: 'mindmap-edge',
    }))
    const edgesToRemove = edges.filter(
      (edge) => edge.source === parentId && selectedIdSet.has(edge.target),
    )

    for (const id of selectedIdSet) editor.setNodeFlag(id, 'processing', true)
    const commands: MindmapCommand[] = [
      { type: 'addNode', node: placeholderNode, edge: treeEdge },
      ...childEdges.map((edge) => ({ type: 'addEdge' as const, edge })),
      ...edgesToRemove.map((edge) => ({ type: 'removeEdge' as const, edgeId: edge.id })),
    ]
    editor.batch(commands)
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
  }, [aiBusy, chatReady, edges, editor, nodes, selectedId, visualVariant])
}
