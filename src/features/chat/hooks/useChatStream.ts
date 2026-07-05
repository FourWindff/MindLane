import { useState, useRef, useCallback, useEffect } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { useAiStore, saveChatHistory } from '@/features/chat/model/aiStore'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { nodeRegistry } from '@/features/mindmap/nodes'
import type { DocumentRef, MindLaneNode } from '@/shared/lib/fileFormat'
import { stripMarkers } from '@/features/chat/lib/chatUtils'
import { handleMindmapToolCall, MINDMAP_ACTION_TOOLS } from '@/features/chat/lib/aiToolCalls'

export function useChatStream() {
  const addMessage = useAiStore((s) => s.addChatMessage)

  const [streamingText, setStreamingText] = useState('')
  const [activeTools, setActiveTools] = useState<string[]>([])
  const streamTextRef = useRef('')
  const finalizedSegmentCountRef = useRef(0)

  const finishStream = useCallback(() => {
    streamTextRef.current = ''
    finalizedSegmentCountRef.current = 0
    setStreamingText('')
    setActiveTools([])
    useAiStore.getState().reset()
  }, [])

  const applyMindmapData = useCallback(
    (data: {
      nodes: MindLaneNode[]
      edges: { id: string; source: string; target: string; type?: string }[]
    }) => {
      const mindmapStore = useMindmapStore.getState()
      const existingNodes = mindmapStore.nodes
      const existingEdges = mindmapStore.edges

      const newTargets = new Set(data.edges.map((e) => e.target))
      const maxX = existingNodes.reduce(
        (m, n) => Math.max(m, n.position.x + (n.measured?.width ?? 200)),
        0,
      )
      const offsetX = existingNodes.length > 0 ? maxX + 300 : 0

      const rawNodes: Node[] = data.nodes.map((n) => {
        const descriptor = nodeRegistry.get(n.type)
        const deserializedData = descriptor ? descriptor.deserialize(n.data) : n.data
        const isRoot = !newTargets.has(n.id)
        return {
          id: n.id,
          type: n.type,
          position: { x: offsetX, y: isRoot ? 0 : 50 },
          data: deserializedData,
        }
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

  const extractGeneratedDocumentRef = useCallback(
    (toolCalls: Array<{ name: string; result: string }> | undefined): DocumentRef | null => {
      if (!toolCalls) return null
      for (const toolCall of toolCalls) {
        if (toolCall.name !== 'generateMindmapFragment') continue
        try {
          const result = JSON.parse(toolCall.result) as {
            ok?: boolean
            documentRef?: DocumentRef | null
          }
          if (result.ok && result.documentRef) return result.documentRef
        } catch {
          return null
        }
      }
      return null
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
      }),
    )

    const unsubMessageStart = api.onStreamMessageStart?.(() => {
      const content = stripMarkers(streamTextRef.current).trim()
      if (!content) return

      addMessage({
        role: 'assistant',
        content,
      })
      finalizedSegmentCountRef.current += 1
      streamTextRef.current = ''
      setStreamingText('')
    })
    if (unsubMessageStart) {
      unsubs.push(unsubMessageStart)
    }

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
        const messages =
          response.messages && response.messages.length > 0
            ? response.messages
            : [
                {
                  role: 'assistant' as const,
                  content: response.content || stripMarkers(streamTextRef.current),
                  toolCalls: response.toolCalls,
                },
              ]

        const finalizedSegmentCount = finalizedSegmentCountRef.current
        useAiStore.setState((state) => ({
          chatMessages: [
            ...state.chatMessages.slice(0, state.chatMessages.length - finalizedSegmentCount),
            ...messages,
          ],
        }))

        if (response.mindmapData) {
          applyMindmapData(response.mindmapData)
        }

        if (response.toolCalls) {
          const mindmapStore = useMindmapStore.getState()
          const generatedDocumentRef = extractGeneratedDocumentRef(response.toolCalls)
          let appliedMindmapChange = false
          for (const toolCall of response.toolCalls) {
            if (MINDMAP_ACTION_TOOLS.includes(toolCall.name)) {
              appliedMindmapChange =
                handleMindmapToolCall(toolCall, mindmapStore) || appliedMindmapChange
            }
          }
          if (generatedDocumentRef && appliedMindmapChange) {
            mindmapStore.addDocumentRef(generatedDocumentRef)
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
  }, [addMessage, applyMindmapData, extractGeneratedDocumentRef, finishStream])

  return {
    streamingText,
    activeTools,
    finishStream,
    applyMindmapData,
  }
}
