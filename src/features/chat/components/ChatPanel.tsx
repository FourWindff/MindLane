import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useAiStore, saveChatHistory, loadWorkspaceChat } from '@/features/chat/model/aiStore'
import { useWorkspaceStore } from '@/features/workspace/store'

import { ChatFab } from './ChatFab'
import { ChatHeader } from './ChatHeader'
import { SessionList } from './SessionList'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { useChatStream } from '@/features/chat/hooks/useChatStream'
import { useChatContext } from '@/features/chat/hooks/useChatContext'

import '../styles/chat-panel.css'

const MAX_ROWS = 4

export function ChatPanel() {
  const threadId = useAiStore((s) => s.threadId)
  const messages = useAiStore((s) => s.chatMessages)
  const busy = useAiStore((s) => s.busy)
  const isMinimized = useAiStore((s) => s.isMinimized)
  const setIsMinimized = useAiStore((s) => s.setIsMinimized)
  const addMessage = useAiStore((s) => s.addChatMessage)
  const sessions = useAiStore((s) => s.sessions)
  const showSessionList = useAiStore((s) => s.showSessionList)
  const setShowSessionList = useAiStore((s) => s.setShowSessionList)
  const loadSession = useAiStore((s) => s.loadSession)
  const deleteSession = useAiStore((s) => s.deleteSession)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputRows, setInputRows] = useState(1)

  const {
    apiKey,
    selectedNodes,
    buildContext,
    clearNodeSelection,
    emptyHint,
    quickActions,
  } = useChatContext()

  const scrollToBottom = useCallback((instant?: boolean) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: instant ? 'instant' : 'smooth',
      })
    })
  }, [])

  const { streamingText, activeTools } = useChatStream(scrollToBottom)

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

  const send = useCallback(async () => {
    const text = inputRef.current?.value.trim()
    if (!text || busy) return
    if (!apiKey) return

    const userMsg = { role: 'user' as const, content: text }
    addMessage(userMsg)
    if (inputRef.current) inputRef.current.value = ''
    setInputRows(1)

    scrollToBottom()
    useAiStore.getState().setBusy(true)
    useAiStore.getState().setStep('chatting')
    void saveChatHistory()

    const api = window.mindlane?.ai
    if (!api) return

    const context = buildContext()
    await api.chatStream({ threadId, message: text, context })
  }, [apiKey, busy, threadId, addMessage, scrollToBottom, buildContext])

  const stop = useCallback(() => {
    const api = window.mindlane?.ai
    if (!api) return
    void api.stopStream()
  }, [])

  const startNewChat = useCallback(async () => {
    await saveChatHistory()
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
    const lineHeight = 20
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

  const handleQuickAction = useCallback((prompt: string) => {
    if (inputRef.current) {
      inputRef.current.value = prompt
      inputRef.current.focus()
    }
  }, [])

  if (isMinimized) {
    return <ChatFab onExpand={() => setIsMinimized(false)} />
  }

  return (
    <motion.div
      className="chat-float-panel"
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
    >
      <ChatHeader
        showSessionList={showSessionList}
        busy={busy}
        onToggleSessionList={toggleSessionList}
        onNewChat={startNewChat}
        onMinimize={() => setIsMinimized(true)}
      />

      <SessionList
        show={showSessionList}
        sessions={sessions}
        activeSessionId={threadId}
        onClose={() => setShowSessionList(false)}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleDeleteSession}
      />

      <MessageList
        ref={scrollRef}
        messages={messages}
        streamingText={streamingText}
        activeTools={activeTools}
        busy={busy}
        emptyHint={emptyHint}
        quickActions={quickActions}
        onQuickAction={handleQuickAction}
      />

      <ChatInput
        ref={inputRef}
        apiKey={apiKey}
        busy={busy}
        inputRows={inputRows}
        selectedNodes={selectedNodes}
        onSend={send}
        onStop={stop}
        onKeyDown={handleKeyDown}
        onInputChange={handleInputChange}
        onClearSelection={clearNodeSelection}
      />
    </motion.div>
  )
}
