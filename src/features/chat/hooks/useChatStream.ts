import { useState, useRef, useCallback, useEffect } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { useAiStore, saveChatHistory } from '@/features/chat/model/aiStore'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { nodeRegistry } from '@/features/mindmap/nodes'
import type { MindLaneNode } from '@/shared/lib/fileFormat'
import { stripMarkers } from '@/features/chat/lib/chatUtils'
import { handleMindmapToolCall, MINDMAP_ACTION_TOOLS } from '@/features/chat/lib/aiToolCalls'

export function useChatStream(scrollToBottom: (instant?: boolean) => void) {
  const addMessage = useAiStore((s) => s.addChatMessage)

  const [streamingText, setStreamingText] = useState('')
  const [activeTools, setActiveTools] = useState<string[]>([])
  const streamTextRef = useRef('')

  const finishStream = useCallback(() => {
    streamTextRef.current = ''
    setStreamingText('')
    setActiveTools([])
    useAiStore.getState().reset()
    scrollToBottom()
  }, [scrollToBottom])

  const applyMindmapData = useCallback(
    (data: { nodes: MindLaneNode[]; edges: { id: string; source: string; target: string; type?: string }[] }) => {
      const mindmapStore = useMindmapStore.getState()
      const existingNodes = mindmapStore.nodes
      const existingEdges = mindmapStore.edges

      const newTargets = new Set(data.edges.map((e) => e.target))
      const maxX = existingNodes.reduce((m, n) => Math.max(m, n.position.x + (n.measured?.width ?? 200)), 0)
      const offsetX = existingNodes.length > 0 ? maxX + 300 : 0

      const rawNodes: Node[] = data.nodes.map((n) => {
        const descriptor = nodeRegistry.get(n.type)
        const deserializedData = descriptor
          ? descriptor.deserialize(n.data)
          : n.data
        const isRoot = !newTargets.has(n.id)
        return { id: n.id, type: n.type, position: { x: offsetX, y: isRoot ? 0 : 50 }, data: deserializedData }
      })

      const newEdges: Edge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type ?? 'mindmap',
        className: 'mindmap-edge mindmap-edge--enter',
      }))

      mindmapStore.setNodes([...existingNodes, ...rawNodes])
      mindmapStore.setEdges([...existingEdges, ...newEdges])
    },
    [],
  )

  useEffect(() => {
    const api = window.mindlane?.ai
    if (!api) return

    const unsubs: Array<() => void> = []

    unsubs.push(
      api.onStreamToken((token) => {
        streamTextRef.current += token
        setStreamingText(stripMarkers(streamTextRef.current))
        scrollToBottom()
      }),
    )

    unsubs.push(
      api.onStreamToolStart((data) => {
        setActiveTools((prev) => [...prev, data.name])
      }),
    )

    unsubs.push(
      api.onStreamToolEnd((data) => {
        setActiveTools((prev) => prev.filter((n) => n !== data.name))
      }),
    )

    unsubs.push(
      api.onStreamEnd((response) => {
        const content = response.content || stripMarkers(streamTextRef.current)
        addMessage({
          role: 'assistant',
          content,
          toolCalls: response.toolCalls,
        })

        if (response.mindmapData) {
          applyMindmapData(response.mindmapData)
        }

        if (response.toolCalls) {
          const mindmapStore = useMindmapStore.getState()
          for (const toolCall of response.toolCalls) {
            if (MINDMAP_ACTION_TOOLS.includes(toolCall.name)) {
              handleMindmapToolCall(toolCall, mindmapStore)
            }
          }
        }

        finishStream()
        void saveChatHistory()
      }),
    )

    unsubs.push(
      api.onStreamError((error) => {
        addMessage({ role: 'assistant', content: `错误：${error}` })
        finishStream()
        void saveChatHistory()
      }),
    )

    return () => unsubs.forEach((fn) => fn())
  }, [addMessage, applyMindmapData, scrollToBottom, finishStream])

  return {
    streamingText,
    activeTools,
    finishStream,
    applyMindmapData,
  }
}
