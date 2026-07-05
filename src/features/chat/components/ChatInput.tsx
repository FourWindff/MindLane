import { forwardRef } from 'react'
import { X, Square, Send, Plus, SlidersHorizontal, Mic, CircleDot, FileText } from 'lucide-react'
import type { Node } from '@xyflow/react'

interface AttachmentInfo {
  name: string
  path: string
  size: number
}

interface ChatInputProps {
  apiKey: string | null
  busy: boolean
  inputRows: number
  selectedNodes: Node[]
  attachment?: AttachmentInfo
  onSend: () => void
  onStop: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onInputChange: () => void
  onClearSelection: () => void
  onSelectAttachment?: () => void
  onRemoveAttachment?: () => void
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(function ChatInput(
  {
    apiKey,
    busy,
    inputRows,
    selectedNodes,
    attachment,
    onSend,
    onStop,
    onKeyDown,
    onInputChange,
    onClearSelection,
    onSelectAttachment,
    onRemoveAttachment,
  },
  ref,
) {
  return (
    <div className="chat-float-input-area">
      <div className="chat-float-input-wrap">
        {(selectedNodes.length > 0 || attachment) && (
          <div className="chat-float-input-tags">
            {selectedNodes.length > 0 && (
              <span className="chat-float-input-tag">
                <CircleDot size={12} strokeWidth={2} />
                {selectedNodes.length}
                <button
                  type="button"
                  className="chat-float-input-tag__remove"
                  onClick={onClearSelection}
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </span>
            )}
            {attachment && (
              <span className="chat-float-input-tag">
                <FileText size={12} strokeWidth={2} />
                {attachment.name}
                <button
                  type="button"
                  className="chat-float-input-tag__remove"
                  onClick={() => onRemoveAttachment?.()}
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </span>
            )}
          </div>
        )}
        <div className="chat-float-input-row">
          <textarea
            ref={ref}
            onKeyDown={onKeyDown}
            onChange={onInputChange}
            placeholder={
              !apiKey
                ? '请先在设置中填写 API Key'
                : attachment
                  ? '输入提示词（可选）...'
                  : '输入消息…'
            }
            disabled={busy || !apiKey}
            rows={inputRows}
            className="chat-float-input"
          />
          {busy ? (
            <button type="button" className="chat-float-stop-btn" onClick={onStop} title="停止生成">
              <Square size={14} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              className="chat-float-send-btn"
              onClick={() => void onSend()}
              disabled={!apiKey}
              title="发送 (Enter)"
            >
              <Send size={14} strokeWidth={2} />
            </button>
          )}
        </div>
        <div className="chat-float-input-toolbar">
          <div className="chat-float-input-toolbar__left">
            <button
              type="button"
              className="chat-float-toolbar-btn"
              title="添加附件"
              onClick={() => onSelectAttachment?.()}
              disabled={busy || !apiKey}
            >
              <Plus size={14} strokeWidth={2} />
            </button>
            <button type="button" className="chat-float-toolbar-btn" title="设置">
              <SlidersHorizontal size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="chat-float-input-toolbar__right">
            <button type="button" className="chat-float-toolbar-btn" title="语音输入">
              <Mic size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
