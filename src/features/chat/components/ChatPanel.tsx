import { useCallback, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useAiStore } from '@/features/chat/model/aiStore'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'

import { ChatFab } from './ChatFab'
import { ChatHeader } from './ChatHeader'
import { SessionList } from './SessionList'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { ActiveSessionsBar } from './ActiveSessionsBar'
import { useChatStream } from '@/features/chat/hooks/useChatStream'
import { useChatContext } from '@/features/chat/hooks/useChatContext'
import { useWorkspaceStore } from '@/features/workspace/store'
import type { DocumentRef } from '@/shared/lib/fileFormat'

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
  const attachedDocument = useAiStore((s) => s.attachedDocument)
  const setAttachedDocument = useAiStore((s) => s.setAttachedDocument)
  const currentFileUuid = useAiStore((s) => s.currentFileUuid)
  const activeSessionsBar = useAiStore((s) => s.activeSessionsBar)
  const openWorkspaceFile = useWorkspaceStore((state) => state.openWorkspaceFile)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputRows, setInputRows] = useState(1)

  const { apiKey, selectedNodes, buildContext, clearNodeSelection, emptyHint, quickActions } =
    useChatContext()

  const { streamingText, activeTools } = useChatStream()

  const handleSelectAttachment = useCallback(async () => {
    const api = window.mindlane?.file
    if (!api?.selectDocument) return

    const result = await api.selectDocument()
    if (result?.ok && result.data) {
      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const docRef: DocumentRef = {
        id,
        type: 'pdf',
        source: result.data.path,
        filename: result.data.name,
        importedAt: new Date().toISOString(),
        sha256: result.data.sha256,
      }
      setAttachedDocument(docRef)
    }
  }, [setAttachedDocument])

  const handleRemoveAttachment = useCallback(() => {
    setAttachedDocument(null)
  }, [setAttachedDocument])

  const send = useCallback(async () => {
    const text = inputRef.current?.value.trim() || ''
    const doc = useAiStore.getState().attachedDocument

    if ((!text && !doc) || busy) return
    if (!apiKey) return

    const userMsg = {
      role: 'user' as const,
      content: text || `请根据「${doc?.filename}」生成思维导图`,
      ...(doc ? { attachment: { name: doc.filename, type: doc.type } } : {}),
    }
    addMessage(userMsg)
    if (inputRef.current) inputRef.current.value = ''
    setInputRows(1)

    useAiStore.getState().setBusy(true)
    useAiStore.getState().setStep('chatting')
    const api = window.mindlane?.ai
    if (!api) return

    const context = buildContext()
    const originFileUuid = useAiStore.getState().currentFileUuid
    const originSessionId = threadId
    const originFileName = context.fileTitle
    setAttachedDocument(null) // clear after context captures the doc
    const result = await api.chatStream({
      threadId: originSessionId,
      message: text || `请根据「${doc?.filename}」生成思维导图`,
      context,
    })
    if (result.ok) {
      const state = useAiStore.getState()
      if (originFileUuid) {
        state.registerStream(originFileUuid, originSessionId, result.streamId, originFileName)
      }
    } else if (originFileUuid) {
      useAiStore.getState().setFileError(originFileUuid, result.error)
    }
  }, [apiKey, busy, threadId, addMessage, buildContext, setAttachedDocument])

  const stop = useCallback(() => {
    const api = window.mindlane?.ai
    if (!api) return
    const streamId = useAiStore.getState().activeStreamId
    if (streamId) {
      useAiStore.getState().markStreamStopping(useAiStore.getState().threadId)
      void api.stopStream(streamId)
    }
  }, [])

  const startNewChat = useCallback(async () => {
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

  const handleLoadSession = useCallback(
    (sessionId: string) => {
      void loadSession(sessionId)
    },
    [loadSession],
  )

  const handleDeleteSession = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      void deleteSession(sessionId)
    },
    [deleteSession],
  )

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

      <ActiveSessionsBar
        entries={Object.values(activeSessionsBar).filter(
          (entry) => entry.fileUuid !== currentFileUuid,
        )}
        onSelect={(fileUuid) => {
          const entry = useAiStore.getState().activeSessionsBar[fileUuid]
          const filePath = mindmapRegistry.getByFileUuid(fileUuid)?.store.getState().filePath
          if (entry && filePath) void openWorkspaceFile(filePath)
        }}
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
        attachment={
          attachedDocument
            ? { name: attachedDocument.filename, path: attachedDocument.source, size: 0 }
            : undefined
        }
        onSend={send}
        onStop={stop}
        onKeyDown={handleKeyDown}
        onInputChange={handleInputChange}
        onClearSelection={clearNodeSelection}
        onSelectAttachment={handleSelectAttachment}
        onRemoveAttachment={handleRemoveAttachment}
      />
    </motion.div>
  )
}
