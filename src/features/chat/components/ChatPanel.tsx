import { useCallback, useEffect, useRef, useState } from 'react'
import { Info, HelpCircle, Sparkles, Check, Square, Send } from 'lucide-react'
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

  const scrollToBottom = useCallback((instant?: boolean) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: instant ? 'instant' : 'smooth',
      })
    })
  }, [])

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
      scrollToBottom(true)
    }
  }, [threadId, messages.length, scrollToBottom])

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
  }, [addMessage, applyMindmapData, scrollToBottom, finishStream])

  const buildContext = useCallback(() => {
    const mindmapState = useMindmapStore.getState()
    const wsState = useWorkspaceStore.getState()
    const ctx: {
      mindmapSummary?: string
      selectedNodes?: ContextNodeInfo[]
      filePath?: string
      fileTitle?: string
      hasDocumentOpen?: boolean
      workspacePath?: string
      workspaceFiles?: { name: string; filePath: string }[]
    } = {}

    if (mindmapState.filePath) ctx.filePath = mindmapState.filePath
    if (mindmapState.fileTitle) ctx.fileTitle = mindmapState.fileTitle
    ctx.hasDocumentOpen = mindmapState.hasDocumentOpen

    if (typeof mindmapState.getContextSummary === 'function') {
      ctx.mindmapSummary = mindmapState.getContextSummary()
    }

    const selected = mindmapState.nodes.filter((n) => n.selected)
    if (selected.length > 0) {
      ctx.selectedNodes = selected.map(extractNodeInfo)
    }

    if (wsState.workspacePath) {
      ctx.workspacePath = wsState.workspacePath
      ctx.workspaceFiles = wsState.files.map((f) => ({
        name: f.name,
        filePath: f.filePath,
      }))
    }

    return ctx
  }, [])

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
            <Info size={32} strokeWidth={1.5} />
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
              <HelpCircle size={28} strokeWidth={1.5} />
            </div>
            <p>输入消息开始对话</p>
            <span className="chat-empty__hint">AI 助手可以检索知识库、生成思维导图和记忆宫殿</span>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble-row ${msg.role === 'user' ? 'chat-bubble-row--user' : 'chat-bubble-row--ai'}`}>
            {msg.role !== 'user' && (
              <div className="chat-avatar chat-avatar--ai">
                <Sparkles size={14} strokeWidth={1.8} />
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
                    <Check size={11} strokeWidth={2} />
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
              <Sparkles size={14} strokeWidth={1.8} />
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
              <Square size={18} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              className="chat-action-btn chat-action-btn--send"
              onClick={() => void send()}
              disabled={!apiKey}
              title="发送 (Enter)"
            >
              <Send size={18} strokeWidth={2} />
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
    listWorkspaceFiles: '查看工作区文件',
  }
  return map[name] ?? name
}
