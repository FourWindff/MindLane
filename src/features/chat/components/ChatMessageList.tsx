import { useCallback } from 'react'
import { Sparkles, FileText, Trash2 } from 'lucide-react'
import {
  selectCurrentChatActiveSessionId,
  selectCurrentChatToolCards,
  selectCurrentChatBusy,
  selectCurrentChatChatMessages,
  selectCurrentChatSessions,
  selectCurrentChatStreamText,
  useAiStore,
  type ChatMessage,
  type ChatSession,
} from '@/features/chat/model/aiStore'
import { useChatContext } from '@/features/chat/hooks/useChatContext'
import { MarkdownContent } from './MarkdownContent'
import { ToolCardList } from './ToolCardList'

import '../styles/chat-message-list.css'

function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

/**
 * Fold pure-tool assistant messages (no text, only tool calls) into the next
 * text-bearing assistant message instead of leaving an empty bubble. When no
 * such message exists before a user boundary (or the end of the list), the
 * cards are kept as a card-only entry so tool records are never dropped.
 */
function mergePureToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = []
  let carried: ChatMessage['toolCalls'] | undefined
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      if (msg.content?.trim()) {
        merged.push({
          ...msg,
          ...(carried?.length ? { toolCalls: [...carried, ...(msg.toolCalls ?? [])] } : {}),
        })
        carried = undefined
        continue
      }
      if (msg.toolCalls?.length) {
        carried = [...(carried ?? []), ...msg.toolCalls]
        continue
      }
    } else if (carried?.length) {
      // A user boundary with no intervening text: keep a card-only entry.
      merged.push({ role: 'assistant', content: '', toolCalls: carried })
      carried = undefined
    }
    merged.push(msg)
  }
  if (carried?.length) {
    merged.push({ role: 'assistant', content: '', toolCalls: carried })
  }
  return merged
}

export function ChatMessageList() {
  const activeSessionId = useAiStore(selectCurrentChatActiveSessionId)
  const messages = useAiStore(selectCurrentChatChatMessages)
  const sessions = useAiStore(selectCurrentChatSessions)
  const busy = useAiStore(selectCurrentChatBusy)
  const showSessionList = useAiStore((s) => s.showSessionList)
  const setShowSessionList = useAiStore((s) => s.setShowSessionList)
  const loadSession = useAiStore((s) => s.loadSession)
  const deleteSession = useAiStore((s) => s.deleteSession)

  const streamingText = useAiStore(selectCurrentChatStreamText)
  const toolCards = useAiStore(selectCurrentChatToolCards)
  const setInputDraft = useAiStore((s) => s.setInputDraft)
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

  const handleQuickAction = useCallback(
    (prompt: string) => {
      setInputDraft(prompt)
    },
    [setInputDraft],
  )

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
                active={session.id === activeSessionId}
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

  // Pure-tool messages are merged forward so no empty bubble is rendered;
  // the merge happens at the display boundary so live and loaded history
  // share the same rule.
  const renderedMessages = mergePureToolMessages(messages)

  return (
    <div
      className={cx('chat-message-list', isEmpty && 'chat-message-list--empty')}
      role="log"
      aria-live="polite"
    >
      {busy && (
        <div className="chat-message-list__row chat-message-list__row--ai">
          <div className="chat-message-list__ai">
            {toolCards.length > 0 && <ToolCardList cards={toolCards} />}
            <div className="chat-message-list__bubble chat-message-list__bubble--ai chat-message-list__bubble--streaming">
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
        </div>
      )}

      {[...renderedMessages].reverse().map((msg, i) => {
        const isUser = msg.role === 'user'
        const toolCalls = msg.toolCalls && msg.toolCalls.length > 0 ? msg.toolCalls : undefined
        return (
          <div
            key={msg.timestamp || `${msg.role}-${messages.length - 1 - i}`}
            className={cx(
              'chat-message-list__row',
              isUser ? 'chat-message-list__row--user' : 'chat-message-list__row--ai',
            )}
          >
            <div className={cx('chat-message-list__ai', isUser && 'chat-message-list__ai--user')}>
              {!isUser && toolCalls && <ToolCardList cards={toolCalls} />}
              {isUser || msg.content?.trim() ? (
                <div
                  className={cx(
                    'chat-message-list__bubble',
                    isUser ? 'chat-message-list__bubble--user' : 'chat-message-list__bubble--ai',
                  )}
                >
                  {isUser && msg.attachment && (
                    <div className="chat-message-list__attachment">
                      <FileText size={12} strokeWidth={2} />
                      <span>{msg.attachment.name}</span>
                    </div>
                  )}
                  <MarkdownContent content={msg.content} />
                </div>
              ) : null}
            </div>
          </div>
        )
      })}

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
