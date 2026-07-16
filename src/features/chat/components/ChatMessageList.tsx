import { useCallback } from 'react'
import { Sparkles, Check, FileText, Trash2 } from 'lucide-react'
import { useAiStore, type ChatSession } from '@/features/chat/model/aiStore'
import { useChatStream } from '@/features/chat/hooks/useChatStream'
import { useChatContext } from '@/features/chat/hooks/useChatContext'
import { MarkdownContent } from './MarkdownContent'
import { toolDisplayName } from '@/features/chat/lib/chatUtils'

import '../styles/chat-message-list.css'

function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export function ChatMessageList() {
  const threadId = useAiStore((s) => s.threadId)
  const messages = useAiStore((s) => s.chatMessages)
  const sessions = useAiStore((s) => s.sessions)
  const busy = useAiStore((s) => s.busy)
  const showSessionList = useAiStore((s) => s.showSessionList)
  const setShowSessionList = useAiStore((s) => s.setShowSessionList)
  const loadSession = useAiStore((s) => s.loadSession)
  const deleteSession = useAiStore((s) => s.deleteSession)

  const { streamingText, activeTools } = useChatStream()
  const { emptyHint, quickActions } = useChatContext()

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
    // Quick actions are surfaced in the input bar in the new layout.
    void prompt
  }, [])

  if (showSessionList) {
    return (
      <div className="chat-message-list chat-message-list--session-mode" role="list">
        <div className="chat-session-list__header">
          <span>历史对话</span>
          <button
            type="button"
            className="chat-session-list__close"
            onClick={() => setShowSessionList(false)}
            aria-label="关闭会话列表"
          >
            ×
          </button>
        </div>
        <div className="chat-session-list__content">
          {sessions.length === 0 ? (
            <div className="chat-session-list__empty">暂无历史对话</div>
          ) : (
            sessions.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                active={session.id === threadId}
                onLoad={handleLoadSession}
                onDelete={handleDeleteSession}
              />
            ))
          )}
        </div>
      </div>
    )
  }

  const isEmpty = messages.length === 0 && !streamingText

  return (
    <div
      className={cx('chat-message-list', isEmpty && 'chat-message-list--empty')}
      role="log"
      aria-live="polite"
    >
      {busy && (
        <div className="chat-message-list__row chat-message-list__row--ai">
          <div className="chat-message-list__bubble chat-message-list__bubble--ai chat-message-list__bubble--streaming">
            {activeTools.length > 0 && (
              <div className="chat-message-list__tools">
                {activeTools.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className="chat-message-list__tool chat-message-list__tool--active"
                  >
                    <span className="chat-message-list__spinner" />
                    {toolDisplayName(name)}
                  </span>
                ))}
              </div>
            )}
            {streamingText ? (
              <MarkdownContent content={streamingText} />
            ) : (
              <div className="chat-message-list__thinking">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>
      )}

      {[...messages].reverse().map((msg, i) => (
        <div
          key={msg.timestamp || `${msg.role}-${messages.length - 1 - i}`}
          className={cx(
            'chat-message-list__row',
            msg.role === 'user' ? 'chat-message-list__row--user' : 'chat-message-list__row--ai',
          )}
        >
          <div
            className={cx(
              'chat-message-list__bubble',
              msg.role === 'user'
                ? 'chat-message-list__bubble--user'
                : 'chat-message-list__bubble--ai',
            )}
          >
            {msg.role === 'user' && msg.attachment && (
              <div className="chat-message-list__attachment">
                <FileText size={12} strokeWidth={2} />
                <span>{msg.attachment.name}</span>
              </div>
            )}
            <MarkdownContent content={msg.content} />
            {msg.role !== 'user' && msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="chat-message-list__tools">
                {msg.toolCalls.map((tc, j) => (
                  <span key={j} className="chat-message-list__tool">
                    <Check size={11} strokeWidth={2} />
                    {toolDisplayName(tc.name)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {isEmpty && (
        <div className="chat-message-list__empty">
          <div className="chat-message-list__empty-icon">
            <Sparkles size={24} strokeWidth={1.5} />
          </div>
          <h3 className="chat-message-list__empty-title">Neural Assistant</h3>
          <span className="chat-message-list__empty-hint">{emptyHint}</span>
          <div className="chat-message-list__empty-actions">
            {quickActions.map((action, i) => (
              <button
                key={`${action.label}-${i}`}
                type="button"
                className="chat-message-list__empty-action"
                onClick={() => handleQuickAction(action.prompt)}
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

function SessionListItem({
  session,
  active,
  onLoad,
  onDelete,
}: {
  session: ChatSession
  active: boolean
  onLoad: (id: string) => void
  onDelete: (id: string, e: React.MouseEvent) => void
}) {
  return (
    <div
      className={cx('chat-session-item', active && 'chat-session-item--active')}
      onClick={() => onLoad(session.id)}
      role="listitem"
    >
      <div className="chat-session-item__info">
        <span className="chat-session-item__title">{session.title}</span>
        <span className="chat-session-item__meta">
          {new Date(session.updatedAt).toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {' · '}
          {session.messageCount} 条消息
        </span>
      </div>
      <button
        type="button"
        className="chat-session-item__delete"
        onClick={(e) => onDelete(session.id, e)}
        aria-label="删除对话"
      >
        <Trash2 size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
