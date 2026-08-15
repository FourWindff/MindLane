import { useCallback } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import { selectChatReady, useSettingsStore } from '@/features/settings/model/settingsStore'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import type { MindmapCommand } from '@/features/mindmap/model/types'
import { findParentId, newId } from '@/shared/lib/mindmapTree'
import { VISUAL_VARIANTS } from '@/features/mindmap/style/presets'
import type { VisualVariant } from '@/features/mindmap/style/types'

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
      ai.setError('IPC 通道不可用，请确认 Electron 环境')
      return
    }

    if (!chatReady) {
      ai.setError('请先在右侧「设置」面板中配置 API Key 并选择模型')
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
      ai.setError('未选中任何主题节点')
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
    ai.setStep('analyzing')

    try {
      const result = await Promise.race([
        mindlane.ai.nodesToPalace({ selectedNodes }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000)),
      ])
      if (!result) {
        rollback()
        ai.setError('生成超时（超过 2 分钟），请检查网络后重试')
        return
      }
      if (!result.ok) {
        rollback()
        const message = (result as { ok: false; error: string }).error || '生成失败（未知错误）'
        ai.setError(`AI 返回错误：${message}`)
        return
      }

      editor.batch([
        {
          type: 'updateNode',
          nodeId: palaceId,
          patch: (node) => ({
            ...node,
            data: {
              label: result.label,
              imageUrl: result.imageUrl,
              stations: result.stations,
              sourceNodeIds: result.sourceNodeIds,
              expanded: true,
              generating: undefined,
            },
          }),
        },
        ...[...selectedIdSet].map((nodeId) => ({
          type: 'updateNode' as const,
          nodeId,
          patch: (node: Node) => ({
            ...node,
            data: { ...node.data, processing: undefined },
          }),
        })),
      ])
      ai.reset()
    } catch (error) {
      rollback()
      ai.setError(`生成异常：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [aiBusy, chatReady, edges, editor, nodes, selectedId, visualVariant])
}
