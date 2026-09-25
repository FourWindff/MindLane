import { afterEach, describe, expect, it } from 'vitest'
import { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import { MindmapHistory } from '@/features/mindmap/model/mindmapHistory'
import { createMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import type { PalaceNodeData } from '@/features/mindmap/nodes/palace/types'
import { simulatePalaceInsert } from '../AgentWriteSimulator'

describe('simulatePalaceInsert', () => {
  afterEach(() => {
    useAiStore.setState({ currentFileUuid: null, fileChats: {} })
  })

  it('replays the palace user operation in front of the selection, then lands the picture', async () => {
    const store = createMindmapStore()
    const editor = new MindmapEditor(store, new MindmapHistory())
    editor.newFile('测试')
    const first = editor.addChild('root', { label: '要点一' }).nodeId
    const second = editor.addChild('root', { label: '要点二' }).nodeId
    editor.setNodeSelected(first, true)
    editor.setNodeSelected(second, true)
    const firstPosition = store.getState().nodes.find((node) => node.id === first)!.position
    useAiStore.setState({ currentFileUuid: 'sim-file' })

    const run = simulatePalaceInsert({
      editor,
      nodes: store.getState().nodes,
      edges: store.getState().edges,
      selectedNodes: [
        { id: first, label: '要点一' },
        { id: second, label: '要点二' },
      ],
      visualVariant: store.getState().style.visualVariant,
      addAsset: store.getState().addAsset,
    })

    // Generating phase: placeholder palace where the selection was, selection hung off it.
    const palace = store.getState().nodes.find((node) => node.type === 'palace')!
    const placeholder = palace.data as PalaceNodeData
    expect(placeholder.label).toBe('生成中…')
    expect(placeholder.generating).toBe(true)
    // Same column the selection sat in; the layout then re-spreads siblings vertically.
    expect(palace.position.x).toBe(firstPosition.x)
    expect(store.getState().edges.some((e) => e.source === 'root' && e.target === first)).toBe(
      false,
    )
    expect(store.getState().edges.some((e) => e.source === palace.id && e.target === first)).toBe(
      true,
    )
    expect(store.getState().edges.some((e) => e.source === palace.id && e.target === second)).toBe(
      true,
    )
    for (const id of [first, second]) {
      const node = store.getState().nodes.find((n) => n.id === id)!
      expect((node.data as { processing?: boolean }).processing).toBe(true)
    }
    // Same busy state the palace flow sets while the subgraph runs.
    expect(selectCurrentChatBusy(useAiStore.getState())).toBe(true)

    await run

    const landed = store.getState().nodes.find((node) => node.id === palace.id)!
    const data = landed.data as PalaceNodeData
    expect(data.generating).toBeUndefined()
    expect(data.expanded).toBe(true)
    expect(data.label).toBe('模拟记忆宫殿')
    expect(data.stations.map((station) => station.order)).toEqual([1, 2])
    expect(data.stations.map((station) => station.linkedNodeId)).toEqual([first, second])
    expect(data.stations.map((station) => station.content)).toEqual(['要点一', '要点二'])
    // Picture embedded as a real asset, exactly like a generated one.
    expect(data.assetId).toBeTruthy()
    expect(store.getState().assets.some((asset) => asset.id === data.assetId)).toBe(true)
    for (const id of [first, second]) {
      const node = store.getState().nodes.find((n) => n.id === id)!
      expect((node.data as { processing?: boolean }).processing).toBeUndefined()
    }
    expect(selectCurrentChatBusy(useAiStore.getState())).toBe(false)
  })
})
