import { useCallback, useRef, useState } from 'react'
import { X, Square, Send, Plus, SlidersHorizontal, Mic, CircleDot, FileText } from 'lucide-react'
import { useAiStore } from '@/features/chat/model/aiStore'
import { useChatContext } from '@/features/chat/hooks/useChatContext'
import { selectChatReady, useSettingsStore } from '@/features/settings/model/settingsStore'
import type { DocumentRef } from '@/shared/lib/fileFormat'

import '../styles/chat-input-bar.css'

const MAX_ROWS = 4

interface ChatInputBarProps {
  onOpenSettings: () => void
}

export function ChatInputBar({ onOpenSettings }: ChatInputBarProps) {
  const busy = useAiStore((s) => s.busy)
  const attachedDocument = useAiStore((s) => s.attachedDocument)
  const setAttachedDocument = useAiStore((s) => s.setAttachedDocument)
  const sendChatMessage = useAiStore((s) => s.sendChatMessage)
  const stopChatStream = useAiStore((s) => s.stopChatStream)

  const { selectedNodes, clearNodeSelection } = useChatContext()

  const chatReady = useSettingsStore(selectChatReady)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const hasApiKey = useSettingsStore((s) => s.apiKey.trim() !== '')
  const hasChatModel = useSettingsStore((s) => s.chatModel.trim() !== '')

  let placeholder = attachedDocument ? '输入提示词（可选）...' : '输入消息…'
  if (!chatReady && settingsLoaded) {
    if (!hasApiKey && !hasChatModel) placeholder = '请先在设置中配置 API Key 并选择模型'
    else if (!hasApiKey) placeholder = '请先在设置中配置 API Key'
    else if (!hasChatModel) placeholder = '请先在设置中选择模型'
  }

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
        type: result.data.type,
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
    const accepted = await sendChatMessage(text)
    if (accepted && inputRef.current) {
      inputRef.current.value = ''
      setInputRows(1)
    }
  }, [sendChatMessage])

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
            placeholder={placeholder}
            disabled={busy || !chatReady}
            rows={inputRows}
            className="chat-input-bar__textarea"
          />
          {busy ? (
            <button
              type="button"
              className="chat-input-bar__stop"
              onClick={stopChatStream}
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
              disabled={!chatReady}
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
              disabled={busy || !chatReady}
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
