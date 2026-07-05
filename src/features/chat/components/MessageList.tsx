import { Sparkles, Check, FileText } from 'lucide-react'
import type { ChatMessage } from '@/features/chat/model/aiStore'
import { MarkdownContent } from './MarkdownContent'
import { toolDisplayName } from '@/features/chat/lib/chatUtils'
import type { QuickAction } from '@/features/chat/hooks/useChatContext'

interface MessageListProps {
  messages: ChatMessage[]
  streamingText: string
  activeTools: string[]
  busy: boolean
  emptyHint: string
  quickActions: QuickAction[]
  onQuickAction: (prompt: string) => void
}

function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export function MessageList({
  messages,
  streamingText,
  activeTools,
  busy,
  emptyHint,
  quickActions,
  onQuickAction,
}: MessageListProps) {
  const isEmpty = messages.length === 0 && !streamingText

  return (
    <div className={cx('chat-float-messages', isEmpty && 'chat-float-messages--empty')}>
      {/* Streaming area rendered first so it anchors to the bottom */}
      {busy && (
        <div className="chat-float-bubble-row chat-float-bubble-row--ai">
          <div className="chat-float-avatar chat-float-avatar--ai">
            <Sparkles size={14} strokeWidth={1.8} />
          </div>
          <div
            className={cx(
              'chat-float-streaming-group',
              !streamingText && 'chat-float-streaming-group--thinking',
            )}
          >
            {activeTools.length > 0 && (
              <div className="chat-float-tool-calls chat-float-tool-calls--active">
                {activeTools.map((name, i) => (
                  <div
                    key={`${name}-${i}`}
                    className="chat-float-tool-tag chat-float-tool-tag--active"
                  >
                    <span className="chat-float-spinner" />
                    <span>{toolDisplayName(name)}</span>
                  </div>
                ))}
              </div>
            )}
            <div
              className={cx(
                'chat-float-bubble chat-float-bubble--ai chat-float-bubble--streaming',
                !streamingText && 'chat-float-bubble--thinking',
              )}
            >
              {streamingText ? (
                <MarkdownContent content={streamingText} />
              ) : (
                <div className="chat-float-thinking">
                  <span className="chat-float-thinking__dot" />
                  <span className="chat-float-thinking__dot" />
                  <span className="chat-float-thinking__dot" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {[...messages].reverse().map((msg, i) => (
        <div
          key={msg.timestamp || `${msg.role}-${messages.length - 1 - i}`}
          className={cx(
            'chat-float-bubble-row',
            msg.role === 'user' ? 'chat-float-bubble-row--user' : 'chat-float-bubble-row--ai',
          )}
        >
          {msg.role !== 'user' && (
            <div className="chat-float-avatar chat-float-avatar--ai">
              <Sparkles size={14} strokeWidth={1.8} />
            </div>
          )}
          {msg.role === 'user' ? (
            <div className="chat-float-bubble chat-float-bubble--user">
              {msg.attachment && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    marginBottom: '4px',
                    background: 'rgba(0,0,0,0.06)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: '#555',
                  }}
                >
                  <FileText size={12} strokeWidth={2} />
                  <span>{msg.attachment.name}</span>
                </div>
              )}
              <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
            </div>
          ) : (
            <div className="chat-float-message-group">
              <div className="chat-float-bubble chat-float-bubble--ai">
                <MarkdownContent content={msg.content} />
              </div>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="chat-float-tool-calls">
                  {msg.toolCalls.map((tc, j) => (
                    <div key={j} className="chat-float-tool-tag">
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

      {isEmpty && (
        <div className="chat-float-empty">
          <div className="chat-float-empty__icon">
            <Sparkles size={24} strokeWidth={1.5} />
          </div>
          <h3 className="chat-float-empty__title">Neural Assistant</h3>
          <span className="chat-float-empty__hint">{emptyHint}</span>
          <div className="chat-float-empty__actions">
            {quickActions.map((action, i) => (
              <button
                key={`${action.label}-${i}`}
                type="button"
                className="chat-float-empty__action"
                onClick={() => onQuickAction(action.prompt)}
              >
                <Sparkles size={12} strokeWidth={2} />
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
