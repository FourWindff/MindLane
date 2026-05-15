import { useCallback, useEffect, useRef, useState } from 'react'
import { Info, HelpCircle, Sparkles, Check, Square, Send, Plus, History, X, Trash2 } from 'lucide-react'
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
  TextNodeData,
  PalaceNodeData,
} from '@/shared/lib/fileFormat'

type ContextNodeInfo = {
  id: string
  type: 'text' | 'palace'
  label: string
  extra?: Record<string, unknown>
}

function extractNodeInfo(node: Node): ContextNodeInfo {
  const data = node.data as Record<string, unknown>
  const nodeType = (node.type ?? 'text') as 'text' | 'palace'

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
    default: {
      const td = data as TextNodeData
      return {
        id: node.id,
        type: 'text',
        label: td.label || node.id,
      }
    }
  }
}

export function ChatPanel() {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const capabilities = useSettingsStore((s) => s.capabilities)
  const threadId = useAiStore((s) => s.threadId)
  const messages = useAiStore((s) => s.chatMessages)
  const busy = useAiStore((s) => s.busy)
  const addMessage = useAiStore((s) => s.addChatMessage)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const sessions = useAiStore((s) => s.sessions)
  const showSessionList = useAiStore((s) => s.showSessionList)
  const setShowSessionList = useAiStore((s) => s.setShowSessionList)
  const loadSession = useAiStore((s) => s.loadSession)
  const deleteSession = useAiStore((s) => s.deleteSession)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [inputRows, setInputRows] = useState(1)
  const MAX_ROWS = 4

  const [streamingText, setStreamingText] = useState('')
  const [activeTools, setActiveTools] = useState<string[]>([])
  const streamTextRef = useRef('')
  const features = ['生成思维导图']

  if (capabilities.includes('embeddings')) {
    features.unshift('检索知识库')
  }
  if (capabilities.includes('imageGen') && capabilities.includes('vision')) {
    features.push('生成记忆宫殿')
  } else if (capabilities.includes('imageGen')) {
    features.push('生成图片')
  }

  const emptyHint = `AI 助手可以${features.join('、')}`

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
        type: e.type ?? 'smoothstep',
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

        // 处理 mindmap 操作工具调用
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
    setInputRows(1)

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

    const context = buildContext()

    // 使用新的接口：只传递当前消息，后端会自动加载历史
    await api.chatStream({
      threadId,
      message: text,  // 当前用户输入
      context,
    })
  }, [apiKey, busy, threadId, addMessage, scrollToBottom, buildContext])

  const stop = useCallback(() => {
    const api = window.mindlane?.ai
    if (!api) return
    void api.stopStream()
  }, [])

  const startNewChat = useCallback(async () => {
    // Save current chat history first
    await saveChatHistory()
    // Then start new chat
    useAiStore.getState().startNewChat()
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

  const handleInputChange = useCallback(() => {
    const textarea = inputRef.current
    if (!textarea) return

    // 计算行数
    const lineHeight = 20 // 估算的行高
    const scrollHeight = textarea.scrollHeight
    const rows = Math.min(MAX_ROWS, Math.max(1, Math.round(scrollHeight / lineHeight)))

    setInputRows(rows)
  }, [])

  const toggleSessionList = useCallback(() => {
    setShowSessionList(!showSessionList)
  }, [showSessionList, setShowSessionList])

  const handleLoadSession = useCallback((sessionId: string) => {
    void loadSession(sessionId)
  }, [loadSession])

  const handleDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    void deleteSession(sessionId)
  }, [deleteSession])

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
      {/* Chat Header */}
      <div className="chat-header">
        <button
          type="button"
          className={`chat-header__history-btn${showSessionList ? ' chat-header__history-btn--active' : ''}`}
          onClick={toggleSessionList}
          disabled={busy}
          title="查看历史对话"
        >
          <History size={14} strokeWidth={2} />
          <span>历史</span>
        </button>
        <button
          type="button"
          className="chat-header__new-btn"
          onClick={startNewChat}
          disabled={busy}
          title="创建新对话"
        >
          <Plus size={14} strokeWidth={2} />
          <span>新对话</span>
        </button>
      </div>

      {/* Session List */}
      {showSessionList && (
        <div className="chat-session-list">
          <div className="chat-session-list__header">
            <span>历史对话</span>
            <button
              type="button"
              className="chat-session-list__close"
              onClick={() => setShowSessionList(false)}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="chat-session-list__content">
            {sessions.length === 0 ? (
              <div className="chat-session-list__empty">暂无历史对话</div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`chat-session-item${session.id === threadId ? ' chat-session-item--active' : ''}`}
                  onClick={() => handleLoadSession(session.id)}
                >
                  <div className="chat-session-item__info">
                    <span className="chat-session-item__title">{session.title}</span>
                    <span className="chat-session-item__meta">
                      {new Date(session.updatedAt).toLocaleString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {session.messageCount} 条消息
                    </span>
                  </div>
                  <button
                    type="button"
                    className="chat-session-item__delete"
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    title="删除对话"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="chat-messages">
        {messages.length === 0 && !streamingText && (
          <div className="chat-empty">
            <div className="chat-empty__icon">
              <HelpCircle size={28} strokeWidth={1.5} />
            </div>
            <p>输入消息开始对话</p>
            <span className="chat-empty__hint">{emptyHint}</span>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble-row ${msg.role === 'user' ? 'chat-bubble-row--user' : 'chat-bubble-row--ai'}`}>
            {msg.role !== 'user' && (
              <div className="chat-avatar chat-avatar--ai">
                <Sparkles size={14} strokeWidth={1.8} />
              </div>
            )}
            {msg.role === 'user' ? (
              <div className="chat-bubble chat-bubble--user">
                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
              </div>
            ) : (
              <div className="chat-message-group">
                <div className="chat-bubble chat-bubble--ai">
                  <MarkdownContent content={msg.content} />
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
            )}
          </div>
        ))}

        {/* Streaming area */}
        {busy && (
          <div className="chat-bubble-row chat-bubble-row--ai">
            <div className="chat-avatar chat-avatar--ai">
              <Sparkles size={14} strokeWidth={1.8} />
            </div>
            <div className={`chat-streaming-group${streamingText ? '' : ' chat-streaming-group--thinking'}`}>
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
              <div className={`chat-bubble chat-bubble--ai chat-bubble--streaming${streamingText ? '' : ' chat-bubble--thinking'}`}>
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
            onChange={handleInputChange}
            placeholder="输入消息…"
            disabled={busy}
            rows={inputRows}
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

const MARKER_RE = /\[(?:INTENT:\w+|PALACE_INPUT:[\s\S]*?|MINDMAP_INPUT:[\s\S]*?|MINDMAP_TITLE:[\s\S]*?)\]/g
const PARTIAL_MARKER_RE = /\[(?:INTENT|PALACE_INPUT|MINDMAP_INPUT|MINDMAP_TITLE)[^\]]*$/i

function stripMarkers(text: string): string {
  return text.replace(MARKER_RE, '').replace(PARTIAL_MARKER_RE, '').trim()
}

// ========== AI 工具调用处理 ==========

import { CHILD_OFFSET_X, CHILD_GAP_Y } from '@/shared/lib/mindmapTree'

interface ToolCallResult {
  name: string
  args: Record<string, unknown>
  result: string
}

interface AddNodeAction {
  type: 'text' | 'palace'
  parentId?: string
  nodeData: Record<string, unknown>
}

interface UpdateNodeAction {
  nodeId: string
  nodeType: string
  changes: Record<string, unknown>
}

interface DeleteNodeAction {
  nodeId: string
  confirmDeleteSubtree: boolean
}

function handleMindmapToolCall(
  toolCall: ToolCallResult,
  mindmapStore: ReturnType<typeof useMindmapStore.getState>
): boolean {
  try {
    const result = JSON.parse(toolCall.result) as
      | { ok: true; action: string; data: unknown }
      | { ok: false; error: string }

    if (!result.ok) {
      console.warn(`[AI Tool] ${toolCall.name} failed:`, result.error)
      return false
    }

    const nodes = mindmapStore.nodes
    const edges = mindmapStore.edges

    switch (result.action) {
      case 'addNode': {
        const data = result.data as AddNodeAction
        const { type, parentId, nodeData } = data

        // 确定父节点 - 优先使用提供的 parentId，其次使用选中的节点，最后使用 root
        let targetParentId = parentId
        if (!targetParentId) {
          // 查找选中的节点
          const selectedNode = nodes.find((n) => n.selected)
          if (selectedNode) {
            targetParentId = selectedNode.id
          } else {
            // 默认使用 root 节点（没有父边的节点）
            const rootNode = nodes.find((n) => !edges.some((e) => e.target === n.id))
            targetParentId = rootNode?.id ?? 'root'
          }
        }

        // 创建新节点
        const newNodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        const parentNode = nodes.find((n) => n.id === targetParentId)

        // 计算位置
        let position = { x: 0, y: 0 }
        if (parentNode) {
          const siblings = edges
            .filter((e) => e.source === targetParentId)
            .map((e) => nodes.find((n) => n.id === e.target))
            .filter(Boolean)

          const siblingCount = siblings.length
          position = {
            x: parentNode.position.x + CHILD_OFFSET_X,
            y: parentNode.position.y + siblingCount * (60 + CHILD_GAP_Y),
          }
        }

        // 根据类型创建节点
        const descriptor = nodeRegistry.get(type)
        const deserializedData = descriptor
          ? descriptor.deserialize(nodeData)
          : nodeData

        const newNode: Node = {
          id: newNodeId,
          type,
          position,
          data: { ...deserializedData, justAdded: true },
        }

        // 添加边
        const newEdge: Edge = {
          id: `e_${targetParentId}_${newNodeId}`,
          source: targetParentId,
          target: newNodeId,
          type: 'smoothstep',
          className: 'mindmap-edge',
        }

        mindmapStore.setNodes([...nodes, newNode])
        mindmapStore.setEdges([...edges, newEdge])
        return true
      }

      case 'updateNode': {
        const data = result.data as UpdateNodeAction
        const { nodeId, nodeType, changes } = data

        mindmapStore.setNodes(
          nodes.map((n) => {
            if (n.id !== nodeId) return n

            // 直接将 changes 合并到当前 data，保留临时状态（justAdded, editing 等）
            const mergedData = { ...n.data, ...changes }

            const descriptor = nodeRegistry.get(nodeType)
            return {
              ...n,
              data: descriptor
                ? descriptor.deserialize(mergedData)
                : mergedData,
            }
          })
        )
        return true
      }

      case 'deleteNode': {
        const data = result.data as DeleteNodeAction
        const { nodeId, confirmDeleteSubtree } = data

        if (!confirmDeleteSubtree) {
          console.warn('[AI Tool] Delete cancelled: user did not confirm')
          return false
        }

        // 收集要删除的节点ID（包括子树）
        const idsToDelete = new Set<string>([nodeId])
        const collectChildren = (parentId: string) => {
          edges
            .filter((e) => e.source === parentId)
            .forEach((e) => {
              idsToDelete.add(e.target)
              collectChildren(e.target)
            })
        }
        collectChildren(nodeId)

        // 先标记为 exiting
        mindmapStore.setNodes(
          nodes.map((n) =>
            idsToDelete.has(n.id)
              ? { ...n, data: { ...n.data, exiting: true } }
              : n
          )
        )

        // 延迟实际删除（等待动画）
        setTimeout(() => {
          const currentNodes = useMindmapStore.getState().nodes
          const currentEdges = useMindmapStore.getState().edges

          useMindmapStore.getState().setNodes(
            currentNodes.filter((n) => !idsToDelete.has(n.id))
          )
          useMindmapStore.getState().setEdges(
            currentEdges.filter(
              (e) => !idsToDelete.has(e.source) && !idsToDelete.has(e.target)
            )
          )
        }, 300)

        return true
      }

      case 'batchAddNodes': {
        const { yamlFragment, parentId } = result.data as { yamlFragment: string; parentId?: string }

        if (!yamlFragment) {
          console.warn('[AI Tool] batchAddNodes: yamlFragment is empty')
          return false
        }

        mindmapStore.insertNodesFromYaml(yamlFragment, { parentId })
        return true
      }

      default:
        console.warn('[AI Tool] Unknown action:', result.action)
        return false
    }
  } catch (err) {
    console.error('[AI Tool] Failed to process tool call:', err)
    return false
  }
}

const MINDMAP_ACTION_TOOLS = [
  'addTextNode',
  'addPalaceNode',
  'updateMindmapNode',
  'deleteMindmapNode',
  'batchAddMindmapNodes',
]

function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    generateMindmap: '生成思维导图',
    generatePalace: '生成记忆宫殿',
    getMindmapContext: '读取导图',
    getSelectedNodes: '读取选中节点',
    listWorkspaceFiles: '查看工作区文件',
    // Mindmap 操作工具
    addTextNode: '添加文本节点',
    addPalaceNode: '添加记忆宫殿',
    updateMindmapNode: '更新节点',
    deleteMindmapNode: '删除节点',
    batchAddMindmapNodes: '批量添加节点',
  }
  return map[name] ?? name
}
