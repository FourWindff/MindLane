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
import {
  useActiveMindmapEditor,
  useActiveMindmapStore,
} from '@/features/mindmap/hooks/useActiveOpenFile'
import {
  selectActiveApiKey,
  selectChatReady,
  useSettingsStore,
} from '@/features/settings/model/settingsStore'
import { useWorkspaceStore } from '@/features/workspace/store'
import type { DocumentRef } from '@contracts/fileFormat'
import { validateUrl, createUrlDocumentRef } from '@/features/chat/lib/urlAttachment'
import '../styles/chat-input-bar.css'

const MAX_ROWS = 4
/** Row height in px; the CSS line box is 0.82rem × 1.45 ≈ 19px (drift is inert for ≤4 rows). */
const LINE_HEIGHT = 20

/** Rows the textarea currently needs, clamped to MAX_ROWS. */
function rowsFor(textarea: HTMLTextAreaElement): number {
  return Math.min(MAX_ROWS, Math.max(1, Math.round(textarea.scrollHeight / LINE_HEIGHT)))
}

interface ChatInputBarProps {
  onOpenSettings: () => void
}

export function ChatInputBar({ onOpenSettings }: ChatInputBarProps) {
  const busy = useAiStore(selectCurrentChatBusy)
  const hasActiveFile = useAiStore(selectCurrentChatHasFile)
  const hasWorkspace = useWorkspaceStore((s) => Boolean(s.workspacePath))
  const attachedDocument = useAiStore((s) => s.attachedDocument)
  const setAttachedDocument = useAiStore((s) => s.setAttachedDocument)
  const sendChatMessage = useAiStore((s) => s.sendChatMessage)
  const stopChatStream = useAiStore((s) => s.stopChatStream)

  const editor = useActiveMindmapEditor()
  const selectedCount = useActiveMindmapStore((s) => s.nodes.filter((n) => n.selected).length)

  const chatReady = useSettingsStore(selectChatReady)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const hasApiKey = useSettingsStore((s) => selectActiveApiKey(s).trim() !== '')
  const hasChatModel = useSettingsStore((s) => s.chatModel.trim() !== '')

  // The resolved chat panel is the entry conversation box: with a workspace but
  // no file open, sending creates and opens the .mindlane file for this turn.
  const inputEnabled = chatReady && (hasActiveFile || hasWorkspace)

  let placeholder = attachedDocument ? 'Enter a prompt (optional)...' : 'Type a message...'
  if (!chatReady && settingsLoaded) {
    if (!hasApiKey && !hasChatModel)
      placeholder = 'Configure an API Key and model in settings first'
    else if (!hasApiKey) placeholder = 'Configure an API Key in settings first'
    else if (!hasChatModel) placeholder = 'Select a model in settings first'
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
      setInputRows(rowsFor(textarea))
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
      draft.trim() ? (validateUrl(draft) ? null : 'Enter a valid http:// or https:// link') : null,
    )
  }, [])

  const handleUrlConfirm = useCallback(() => {
    const url = validateUrl(urlDraft)
    if (!url) {
      setUrlError('Enter a valid http:// or https:// link')
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
    setInputRows(rowsFor(textarea))
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
              placeholder="Paste a link, http/https only"
              aria-label="Paste link"
              spellCheck={false}
            />
            <button
              type="button"
              className="chat-input-bar__url-btn"
              onClick={handleUrlConfirm}
              aria-label="Add link"
            >
              Add
            </button>
            <button
              type="button"
              className="chat-input-bar__url-btn chat-input-bar__url-btn--ghost"
              onClick={closeAttachMenu}
              aria-label="Cancel pasting link"
            >
              Cancel
            </button>
            {urlError && <span className="chat-input-bar__url-error">{urlError}</span>}
          </div>
        )}
        {(selectedCount > 0 || attachedDocument) && (
          <div className="chat-input-bar__tags">
            {selectedCount > 0 && (
              <span className="chat-input-bar__tag">
                <CircleDot size={12} strokeWidth={2} />
                {selectedCount}
                <button
                  type="button"
                  className="chat-input-bar__tag-remove"
                  onClick={() => editor.clearNodeSelection()}
                  aria-label="Clear node selection"
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
                  aria-label="Remove attachment"
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
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square size={14} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              className="chat-input-bar__send"
              onClick={() => void send()}
              disabled={!inputEnabled}
              title="Send (Enter)"
              aria-label="Send"
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
                title="Add attachment"
                aria-label="Add attachment"
                onClick={() => setAttachMenuOpen((open) => !open)}
                disabled={busy || !inputEnabled}
              >
                <Plus size={14} strokeWidth={2} />
              </button>
              {attachMenuOpen && !urlMode && (
                <div className="chat-input-bar__menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void handleAttachFile()}>
                    <FileText size={13} strokeWidth={2} />
                    Add file
                  </button>
                  <button type="button" role="menuitem" onClick={handleOpenUrlMode}>
                    <Link size={13} strokeWidth={2} />
                    Paste link
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="chat-input-bar__tool"
              title="Settings"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              <SlidersHorizontal size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="chat-input-bar__toolbar-right">
            <button
              type="button"
              className="chat-input-bar__tool"
              title="Voice input"
              aria-label="Voice input"
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
