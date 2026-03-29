import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Node, Edge } from '@xyflow/react'
import { useAiStore, saveChatHistory, loadWorkspaceChat } from '@/features/chat/model/aiStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { useWorkspaceStore } from '@/features/workspace/store'
import { nodeRegistry } from '@/features/mindmap/nodes'
import type {
  MindLaneNode,
  TopicNodeData,
  PalaceNodeData,
  DocumentNodeData,
} from '@/shared/lib/fileFormat'

type ContextNodeInfo = {
  id: string
  type: 'topic' | 'palace' | 'document'
  label: string
  extra?: Record<string, unknown>
}

function extractNodeInfo(node: Node): ContextNodeInfo {
  const data = node.data as Record<string, unknown>
  const nodeType = (node.type ?? 'topic') as 'topic' | 'palace' | 'document'

  switch (nodeType) {
    case 'palace': {
      const pd = data as PalaceNodeData
      return {
        id: node.id,
        type: 'palace',
        label: pd.label || node.id,
        extra: {
          stationCount: pd.stations?.length ?? 0,
          sourceNodeIds: pd.sourceNodeIds,
        },
      }
    }
    case 'document': {
      const dd = data as DocumentNodeData
      return {
        id: node.id,
        type: 'document',
        label: dd.filename || node.id,
        extra: { excerpt: dd.excerpt },
      }
    }
    default: {
      const td = data as TopicNodeData
      return {
        id: node.id,
        type: 'topic',
        label: td.label || node.id,
      }
    }
  }
}

export function ChatPanel() {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const threadId = useAiStore((s) => s.threadId)
  const messages = useAiStore((s) => s.chatMessages)
  const busy = useAiStore((s) => s.busy)
  const addMessage = useAiStore((s) => s.addChatMessage)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [streamingText, setStreamingText] = useState('')
  const [activeTools, setActiveTools] = useState<string[]>([])
  const streamTextRef = useRef('')

  // Load chat history when workspace changes
  useEffect(() => {
    if (workspacePath) {
      void loadWorkspaceChat(workspacePath)
    } else {
      useAiStore.setState({ threadId: '', chatMessages: [], workspacePath: null })
    }
  }, [workspacePath])

  // Scroll to bottom on initial load
  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current!.scrollHeight })
      })
    }
  }, [threadId])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }, [])

  const finishStream = useCallback(() => {
    streamTextRef.current = ''
    setStreamingText('')
    setActiveTools([])
    useAiStore.getState().reset()
    scrollToBottom()
  }, [scrollToBottom])

  useEffect(() => {
    const api = window.mindlane?.ai
    if (!api) return

    const unsubs: Array<() => void> = []

    unsubs.push(
      api.onStreamToken((token) => {
        streamTextRef.current += token
        setStreamingText(streamTextRef.current)
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
        const content = streamTextRef.current || response.content
        addMessage({
          role: 'assistant',
          content,
          toolCalls: response.toolCalls,
        })

        if (response.mindmapData) {
          applyMindmapData(response.mindmapData)
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
  }, [addMessage, scrollToBottom, finishStream])

  const buildContext = useCallback(() => {
    const state = useMindmapStore.getState()
    const ctx: {
      mindmapSummary?: string
      selectedNodes?: ContextNodeInfo[]
      filePath?: string
      fileTitle?: string
    } = {}

    if (state.filePath) ctx.filePath = state.filePath
    if (state.fileTitle) ctx.fileTitle = state.fileTitle

    if (typeof state.getContextSummary === 'function') {
      ctx.mindmapSummary = state.getContextSummary()
    }

    const selected = state.nodes.filter((n) => n.selected)
    if (selected.length > 0) {
      ctx.selectedNodes = selected.map(extractNodeInfo)
    }

    return ctx
  }, [])

  const applyMindmapData = useCallback(
    (data: { nodes: MindLaneNode[]; edges: { id: string; source: string; target: string; type?: string }[] }) => {
      const mindmapStore = useMindmapStore.getState()
      const existingNodes = mindmapStore.nodes
      const existingEdges = mindmapStore.edges
      const maxX = existingNodes.reduce((m, n) => Math.max(m, n.position.x), 0)
      const offsetX = maxX + 600

      const newNodes: Node[] = data.nodes.map((n) => {
        const descriptor = nodeRegistry.get(n.type)
        const deserializedData = descriptor
          ? descriptor.deserialize(n.data)
          : n.data

        return {
          id: n.id,
          type: n.type,
          position: { x: n.position.x + offsetX, y: n.position.y },
          data: deserializedData,
        }
      })

      const newEdges: Edge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type ?? 'smoothstep',
        className: 'mindmap-edge mindmap-edge--enter',
      }))

      mindmapStore.setNodes([...existingNodes, ...newNodes])
      mindmapStore.setEdges([...existingEdges, ...newEdges])
    },
    [],
  )

  const send = useCallback(async () => {
    const text = inputRef.current?.value.trim()
    if (!text || busy) return
    if (!apiKey) return

    const userMsg = { role: 'user' as const, content: text }
    addMessage(userMsg)
    if (inputRef.current) inputRef.current.value = ''

    streamTextRef.current = ''
    setStreamingText('')
    setActiveTools([])

    useAiStore.getState().setBusy(true)
    useAiStore.getState().setStep('chatting')
    scrollToBottom()

    // Save user message immediately
    void saveChatHistory()

    const api = window.mindlane?.ai
    if (!api) return

    const allMessages = [...useAiStore.getState().chatMessages]
    const context = buildContext()

    await api.chatStream({
      threadId,
      messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
      context,
    })
  }, [apiKey, busy, threadId, addMessage, scrollToBottom, buildContext])

  const stop = useCallback(() => {
    const api = window.mindlane?.ai
    if (!api) return
    void api.stopStream()
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void send()
      }
    },
    [send],
  )

  if (!apiKey) {
    return (
      <div className="chat-panel">
        <div className="chat-empty">
          <div className="chat-empty__icon">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2z" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </div>
          <p>请先在「设置」中填写 API Key</p>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-panel">
      {/* Messages */}
      <div ref={scrollRef} className="chat-messages">
        {messages.length === 0 && !streamingText && (
          <div className="chat-empty">
            <div className="chat-empty__icon">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <p>输入消息开始对话</p>
            <span className="chat-empty__hint">AI 助手可以检索知识库、生成思维导图和记忆宫殿</span>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble-row ${msg.role === 'user' ? 'chat-bubble-row--user' : 'chat-bubble-row--ai'}`}>
            {msg.role !== 'user' && (
              <div className="chat-avatar chat-avatar--ai">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                </svg>
              </div>
            )}
            <div className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble--user' : 'chat-bubble--ai'}`}>
              {msg.role === 'user' ? (
                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
              ) : (
                <MarkdownContent content={msg.content} />
              )}
            </div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="chat-tool-calls">
                {msg.toolCalls.map((tc, j) => (
                  <div key={j} className="chat-tool-tag">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{toolDisplayName(tc.name)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Streaming area */}
        {busy && (
          <div className="chat-bubble-row chat-bubble-row--ai">
            <div className="chat-avatar chat-avatar--ai">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
              </svg>
            </div>
            <div className="chat-streaming-group">
              {activeTools.length > 0 && (
                <div className="chat-tool-calls chat-tool-calls--active">
                  {activeTools.map((name, i) => (
                    <div key={i} className="chat-tool-tag chat-tool-tag--active">
                      <span className="chat-spinner" />
                      <span>{toolDisplayName(name)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="chat-bubble chat-bubble--ai chat-bubble--streaming">
                {streamingText ? (
                  <MarkdownContent content={streamingText} />
                ) : (
                  <div className="chat-thinking">
                    <span className="chat-thinking__dot" />
                    <span className="chat-thinking__dot" />
                    <span className="chat-thinking__dot" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <div className="chat-input-wrap">
          <textarea
            ref={inputRef}
            onKeyDown={handleKeyDown}
            placeholder="输入消息…"
            disabled={busy}
            rows={1}
            className="chat-input"
          />
          {busy ? (
            <button
              type="button"
              className="chat-action-btn chat-action-btn--stop"
              onClick={stop}
              title="停止生成"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="chat-action-btn chat-action-btn--send"
              onClick={() => void send()}
              disabled={!apiKey}
              title="发送 (Enter)"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
        <span className="chat-input-hint">Enter 发送，Shift+Enter 换行</span>
      </div>
    </div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    searchDocuments: '检索知识库',
    listKnowledgeBase: '查看知识库',
    generateMindmap: '生成思维导图',
    generatePalace: '生成记忆宫殿',
    getMindmapContext: '读取导图',
    getSelectedNodes: '读取选中节点',
  }
  return map[name] ?? name
}
