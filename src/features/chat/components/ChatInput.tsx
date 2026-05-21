import { forwardRef } from 'react'
import { X, Square, Send, Plus, SlidersHorizontal, Mic, CircleDot } from 'lucide-react'
import type { Node } from '@xyflow/react'

interface ChatInputProps {
  apiKey: string | null
  busy: boolean
  inputRows: number
  selectedNodes: Node[]
  onSend: () => void
  onStop: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onInputChange: () => void
  onClearSelection: () => void
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    {
      apiKey,
      busy,
      inputRows,
      selectedNodes,
      onSend,
      onStop,
      onKeyDown,
      onInputChange,
      onClearSelection,
    },
    ref,
  ) {
    return (
      <div className="chat-float-input-area">
        <div className="chat-float-input-wrap">
          {selectedNodes.length > 0 && (
            <div className="chat-float-input-tags">
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
            </div>
          )}
          <div className="chat-float-input-row">
            <textarea
              ref={ref}
              onKeyDown={onKeyDown}
              onChange={onInputChange}
              placeholder={apiKey ? '输入消息…' : '请先在设置中填写 API Key'}
              disabled={busy || !apiKey}
              rows={inputRows}
              className="chat-float-input"
            />
            {busy ? (
              <button
                type="button"
                className="chat-float-stop-btn"
                onClick={onStop}
                title="停止生成"
              >
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
              <button type="button" className="chat-float-toolbar-btn" title="添加附件">
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
  }
)
