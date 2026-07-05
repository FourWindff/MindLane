import { motion, AnimatePresence } from 'motion/react'
import { X, Trash2 } from 'lucide-react'
import type { ChatSession } from '@/features/chat/model/aiStore'

interface SessionListProps {
  show: boolean
  sessions: ChatSession[]
  activeSessionId: string
  onClose: () => void
  onLoadSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string, e: React.MouseEvent) => void
}

export function SessionList({
  show,
  sessions,
  activeSessionId,
  onClose,
  onLoadSession,
  onDeleteSession,
}: SessionListProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="chat-float-session-list"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="chat-float-session-list__header">
            <span>历史对话</span>
            <button type="button" className="chat-float-session-list__close" onClick={onClose}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="chat-float-session-list__content">
            {sessions.length === 0 ? (
              <div className="chat-float-session-list__empty">暂无历史对话</div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`chat-float-session-item${session.id === activeSessionId ? ' chat-float-session-item--active' : ''}`}
                  onClick={() => onLoadSession(session.id)}
                >
                  <div className="chat-float-session-item__info">
                    <span className="chat-float-session-item__title">{session.title}</span>
                    <span className="chat-float-session-item__meta">
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
                    className="chat-float-session-item__delete"
                    onClick={(e) => onDeleteSession(session.id, e)}
                    title="删除对话"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
