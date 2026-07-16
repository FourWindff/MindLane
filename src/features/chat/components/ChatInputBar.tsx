import { useCallback, useRef, useState } from 'react'
import { X, Square, Send, Plus, SlidersHorizontal, Mic, CircleDot, FileText } from 'lucide-react'
import { useAiStore } from '@/features/chat/model/aiStore'
import { useChatContext } from '@/features/chat/hooks/useChatContext'
import type { DocumentRef } from '@/shared/lib/fileFormat'

import '../styles/chat-input-bar.css'

const MAX_ROWS = 4

interface ChatInputBarProps {
  onOpenSettings: () => void
}

export function ChatInputBar({ onOpenSettings }: ChatInputBarProps) {
  const threadId = useAiStore((s) => s.threadId)
  const busy = useAiStore((s) => s.busy)
  const addMessage = useAiStore((s) => s.addChatMessage)
  const attachedDocument = useAiStore((s) => s.attachedDocument)
  const setAttachedDocument = useAiStore((s) => s.setAttachedDocument)

  const { apiKey, selectedNodes, buildContext, clearNodeSelection } = useChatContext()

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputRows, setInputRows] = useState(1)
  const [recording, setRecording] = useState(false)

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
    setAttachedDocument(null)
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

  return (
    <div className="chat-input-bar">
      {recording && (
        <div className="chat-input-bar__voice-overlay" aria-hidden="true">
          <span className="chat-input-bar__voice-bar" />
          <span className="chat-input-bar__voice-bar" />
          <span className="chat-input-bar__voice-bar" />
          <span className="chat-input-bar__voice-bar" />
          <span className="chat-input-bar__voice-bar" />
        </div>
      )}
      <div className="chat-input-bar__wrap">
        {(selectedNodes.length > 0 || attachedDocument) && (
          <div className="chat-input-bar__tags">
            {selectedNodes.length > 0 && (
              <span className="chat-input-bar__tag">
                <CircleDot size={12} strokeWidth={2} />
                {selectedNodes.length}
                <button
                  type="button"
                  className="chat-input-bar__tag-remove"
                  onClick={clearNodeSelection}
                  aria-label="清除节点选择"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </span>
            )}
            {attachedDocument && (
              <span className="chat-input-bar__tag">
                <FileText size={12} strokeWidth={2} />
                {attachedDocument.filename}
                <button
                  type="button"
                  className="chat-input-bar__tag-remove"
                  onClick={handleRemoveAttachment}
                  aria-label="移除附件"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </span>
            )}
          </div>
        )}
        <div className="chat-input-bar__row">
          <textarea
            ref={inputRef}
            onKeyDown={handleKeyDown}
            onChange={handleInputChange}
            placeholder={
              !apiKey
                ? '请先在设置中填写 API Key'
                : attachedDocument
                  ? '输入提示词（可选）...'
                  : '输入消息…'
            }
            disabled={busy || !apiKey}
            rows={inputRows}
            className="chat-input-bar__textarea"
          />
          {busy ? (
            <button
              type="button"
              className="chat-input-bar__stop"
              onClick={stop}
              title="停止生成"
              aria-label="停止生成"
            >
              <Square size={14} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              className="chat-input-bar__send"
              onClick={() => void send()}
              disabled={!apiKey}
              title="发送 (Enter)"
              aria-label="发送"
            >
              <Send size={14} strokeWidth={2} />
            </button>
          )}
        </div>
        <div className="chat-input-bar__toolbar">
          <div className="chat-input-bar__toolbar-left">
            <button
              type="button"
              className="chat-input-bar__tool"
              title="添加附件"
              aria-label="添加附件"
              onClick={() => void handleSelectAttachment()}
              disabled={busy || !apiKey}
            >
              <Plus size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="chat-input-bar__tool"
              title="设置"
              aria-label="设置"
              onClick={onOpenSettings}
            >
              <SlidersHorizontal size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="chat-input-bar__toolbar-right">
            <button
              type="button"
              className="chat-input-bar__tool"
              title="语音输入"
              aria-label="语音输入"
              onPointerDown={() => setRecording(true)}
              onPointerUp={() => setRecording(false)}
              onPointerLeave={() => setRecording(false)}
            >
              <Mic size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
