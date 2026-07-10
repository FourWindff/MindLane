import { useCallback } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { useAiStore } from '@/features/chat/model/aiStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import type { MindmapCommand } from '@/features/mindmap/model/types'
import { findParentId, newId, CHILD_OFFSET_X } from '@/shared/lib/mindmapTree'

export function usePalaceGeneration({
  nodes,
  edges,
  selectedId,
  editor,
}: {
  nodes: Node[]
  edges: Edge[]
  selectedId: string | null
  editor: MindmapEditor
}) {
  const aiBusy = useAiStore((state) => state.busy)
  const apiKey = useSettingsStore((state) => state.apiKey)
  const chatModel = useSettingsStore((state) => state.chatModel)

  return useCallback(async () => {
    if (aiBusy) return

    const ai = useAiStore.getState()
    const settings = useSettingsStore.getState()
    const mindlane = typeof window !== 'undefined' ? window.mindlane : undefined
    if (!mindlane) {
      ai.setError('IPC 通道不可用，请确认 Electron 环境')
      return
    }

    const backendSettings = await mindlane.settings.load()
    const currentKey = backendSettings?.apiKey || apiKey || settings.apiKey
    const currentModel =
      backendSettings?.chatModel || chatModel || settings.chatModel || 'qwen-turbo'

    if (!currentKey) {
      ai.setError('请先在右侧「设置」面板中填写 API Key')
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
    const placeholderNode: Node = {
      id: palaceId,
      type: 'palace',
      position: {
        x: firstSelected?.position.x ?? (parentNode?.position.x ?? 0) + CHILD_OFFSET_X,
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
        mindlane.ai.nodesToPalace({ apiKey: currentKey, model: currentModel, selectedNodes }),
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
  }, [aiBusy, apiKey, chatModel, edges, editor, nodes, selectedId])
}
