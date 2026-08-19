import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X,
  Square,
  Send,
  Plus,
  SlidersHorizontal,
  Mic,
  CircleDot,
  FileText,
  Link,
} from 'lucide-react'
import {
  useAiStore,
  selectCurrentChatBusy,
  selectCurrentChatHasFile,
} from '@/features/chat/model/aiStore'
import { useChatContext } from '@/features/chat/hooks/useChatContext'
import { selectChatReady, useSettingsStore } from '@/features/settings/model/settingsStore'
import type { DocumentRef } from '@/shared/lib/fileFormat'
import { validateUrl, createUrlDocumentRef } from '@/features/chat/lib/urlAttachment'

import '../styles/chat-input-bar.css'

const MAX_ROWS = 4

interface ChatInputBarProps {
  onOpenSettings: () => void
}

export function ChatInputBar({ onOpenSettings }: ChatInputBarProps) {
  const busy = useAiStore(selectCurrentChatBusy)
  const hasActiveFile = useAiStore(selectCurrentChatHasFile)
  const attachedDocument = useAiStore((s) => s.attachedDocument)
  const setAttachedDocument = useAiStore((s) => s.setAttachedDocument)
  const sendChatMessage = useAiStore((s) => s.sendChatMessage)
  const stopChatStream = useAiStore((s) => s.stopChatStream)

  const { selectedNodes, clearNodeSelection } = useChatContext()

  const chatReady = useSettingsStore(selectChatReady)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const hasApiKey = useSettingsStore((s) => s.apiKey.trim() !== '')
  const hasChatModel = useSettingsStore((s) => s.chatModel.trim() !== '')

  // 源头不变量：没有活动文件时不能发起对话（输入组件 disabled 条件）。
  // 下游（Runner / 发送路径）不做存在性检查。
  const inputEnabled = chatReady && hasActiveFile

  let placeholder = attachedDocument ? '输入提示词（可选）...' : '输入消息…'
  if (!chatReady && settingsLoaded) {
    if (!hasApiKey && !hasChatModel) placeholder = '请先在设置中配置 API Key 并选择模型'
    else if (!hasApiKey) placeholder = '请先在设置中配置 API Key'
    else if (!hasChatModel) placeholder = '请先在设置中选择模型'
  } else if (!hasActiveFile) {
    placeholder = '请先打开一个 .mindlane 文件'
  }

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputRows, setInputRows] = useState(1)
  const [recording, setRecording] = useState(false)

  const inputDraft = useAiStore((s) => s.inputDraft)
  const setInputDraft = useAiStore((s) => s.setInputDraft)

  // Consume the one-shot draft written by quick-action buttons: fill the
  // textarea and clear the draft so it cannot be re-applied on re-render.
  useEffect(() => {
    if (!inputDraft) return
    const textarea = inputRef.current
    if (textarea) {
      textarea.value = inputDraft
      const lineHeight = 20
      const rows = Math.min(MAX_ROWS, Math.max(1, Math.round(textarea.scrollHeight / lineHeight)))
      setInputRows(rows)
    }
    setInputDraft('')
  }, [inputDraft, setInputDraft])

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

  // Attachment menu + paste-link panel. URL and file attachments share the
  // single attachedDocument slot.
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [urlMode, setUrlMode] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const urlPanelRef = useRef<HTMLDivElement>(null)

  const closeAttachMenu = useCallback(() => {
    setAttachMenuOpen(false)
    setUrlMode(false)
    setUrlDraft('')
    setUrlError(null)
  }, [])

  useEffect(() => {
    if (!attachMenuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      const inMenu = attachMenuRef.current?.contains(target)
      // The url panel lives outside the attach button in the input wrap, so
      // clicking it must not count as an outside click (that would clear the
      // draft and close the panel before the confirm click lands).
      const inUrlPanel = urlPanelRef.current?.contains(target)
      if (!inMenu && !inUrlPanel) {
        closeAttachMenu()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [attachMenuOpen, closeAttachMenu])

  useEffect(() => {
    if (urlMode) urlInputRef.current?.focus()
  }, [urlMode])

  const handleAttachFile = useCallback(async () => {
    setAttachMenuOpen(false)
    await handleSelectAttachment()
  }, [handleSelectAttachment])

  const handleOpenUrlMode = useCallback(() => {
    setUrlMode(true)
  }, [])

  const handleUrlDraftChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const draft = e.target.value
    setUrlDraft(draft)
    setUrlError(
      draft.trim() ? (validateUrl(draft) ? null : '请输入有效的 http:// 或 https:// 链接') : null,
    )
  }, [])

  const handleUrlConfirm = useCallback(() => {
    const url = validateUrl(urlDraft)
    if (!url) {
      setUrlError('请输入有效的 http:// 或 https:// 链接')
      return
    }
    setAttachedDocument(createUrlDocumentRef(url))
    closeAttachMenu()
  }, [urlDraft, setAttachedDocument, closeAttachMenu])

  const handleUrlKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleUrlConfirm()
      } else if (e.key === 'Escape') {
        closeAttachMenu()
      }
    },
    [handleUrlConfirm, closeAttachMenu],
  )

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
        {urlMode && (
          <div className="chat-input-bar__url" ref={urlPanelRef}>
            <span className="chat-input-bar__url-icon">
              <Link size={12} strokeWidth={2} />
            </span>
            <input
              ref={urlInputRef}
              className="chat-input-bar__url-input"
              value={urlDraft}
              onChange={handleUrlDraftChange}
              onKeyDown={handleUrlKeyDown}
              placeholder="粘贴链接，仅支持 http/https"
              aria-label="粘贴链接"
              spellCheck={false}
            />
            <button
              type="button"
              className="chat-input-bar__url-btn"
              onClick={handleUrlConfirm}
              aria-label="添加链接"
            >
              添加
            </button>
            <button
              type="button"
              className="chat-input-bar__url-btn chat-input-bar__url-btn--ghost"
              onClick={closeAttachMenu}
              aria-label="取消粘贴链接"
            >
              取消
            </button>
            {urlError && <span className="chat-input-bar__url-error">{urlError}</span>}
          </div>
        )}
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
                {attachedDocument.type === 'url' ? (
                  <Link size={12} strokeWidth={2} />
                ) : (
                  <FileText size={12} strokeWidth={2} />
                )}
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
            disabled={busy || !inputEnabled}
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
              disabled={!inputEnabled}
              title="发送 (Enter)"
              aria-label="发送"
            >
              <Send size={14} strokeWidth={2} />
            </button>
          )}
        </div>
        <div className="chat-input-bar__toolbar">
          <div className="chat-input-bar__toolbar-left">
            <div className="chat-input-bar__attach" ref={attachMenuRef}>
              <button
                type="button"
                className="chat-input-bar__tool"
                title="添加附件"
                aria-label="添加附件"
                onClick={() => setAttachMenuOpen((open) => !open)}
                disabled={busy || !inputEnabled}
              >
                <Plus size={14} strokeWidth={2} />
              </button>
              {attachMenuOpen && !urlMode && (
                <div className="chat-input-bar__menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void handleAttachFile()}>
                    <FileText size={13} strokeWidth={2} />
                    添加文件
                  </button>
                  <button type="button" role="menuitem" onClick={handleOpenUrlMode}>
                    <Link size={13} strokeWidth={2} />
                    粘贴链接
                  </button>
                </div>
              )}
            </div>
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
