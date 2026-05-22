import { forwardRef } from 'react'
import { Sparkles, Check } from 'lucide-react'
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

export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(
  function MessageList(
    { messages, streamingText, activeTools, busy, emptyHint, quickActions, onQuickAction },
    ref,
  ) {
    return (
      <div ref={ref} className="chat-float-messages">
        {messages.length === 0 && !streamingText && (
          <div className="chat-float-empty">
            <div className="chat-float-empty__icon">
              <Sparkles size={24} strokeWidth={1.5} />
            </div>
            <h3 className="chat-float-empty__title">Neural Assistant</h3>
            <span className="chat-float-empty__hint">{emptyHint}</span>
            <div className="chat-float-empty__actions">
              {quickActions.map((action) => (
                <button
                  key={action.label}
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

        {messages.map((msg, i) => (
          <div key={i} className={`chat-float-bubble-row ${msg.role === 'user' ? 'chat-float-bubble-row--user' : 'chat-float-bubble-row--ai'}`}>
            {msg.role !== 'user' && (
              <div className="chat-float-avatar chat-float-avatar--ai">
                <Sparkles size={14} strokeWidth={1.8} />
              </div>
            )}
            {msg.role === 'user' ? (
              <div className="chat-float-bubble chat-float-bubble--user">
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

        {/* Streaming area */}
        {busy && (
          <div className="chat-float-bubble-row chat-float-bubble-row--ai">
            <div className="chat-float-avatar chat-float-avatar--ai">
              <Sparkles size={14} strokeWidth={1.8} />
            </div>
            <div className={`chat-float-streaming-group${streamingText ? '' : ' chat-float-streaming-group--thinking'}`}>
              {activeTools.length > 0 && (
                <div className="chat-float-tool-calls chat-float-tool-calls--active">
                  {activeTools.map((name, i) => (
                    <div key={i} className="chat-float-tool-tag chat-float-tool-tag--active">
                      <span className="chat-float-spinner" />
                      <span>{toolDisplayName(name)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className={`chat-float-bubble chat-float-bubble--ai chat-float-bubble--streaming${streamingText ? '' : ' chat-float-bubble--thinking'}`}>
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
      </div>
    )
  }
)
