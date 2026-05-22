import { History, Plus, ChevronRight } from 'lucide-react'

interface ChatHeaderProps {
  showSessionList: boolean
  busy: boolean
  onToggleSessionList: () => void
  onNewChat: () => void
  onMinimize: () => void
}

export function ChatHeader({
  showSessionList,
  busy,
  onToggleSessionList,
  onNewChat,
  onMinimize,
}: ChatHeaderProps) {
  return (
    <div className="chat-float-header">
      <div className="chat-float-header__status">
        <span className="chat-float-header__pulse" />
        <span className="chat-float-header__label">SYNC_ACTIVE</span>
      </div>
      <div className="chat-float-header__actions">
        <button
          type="button"
          className={`chat-float-header__btn${showSessionList ? ' chat-float-header__btn--active' : ''}`}
          onClick={onToggleSessionList}
          disabled={busy}
          title="查看历史对话"
        >
          <History size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="chat-float-header__btn"
          onClick={onNewChat}
          disabled={busy}
          title="创建新对话"
        >
          <Plus size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="chat-float-header__close"
          onClick={onMinimize}
          title="收起面板"
        >
          <ChevronRight size={18} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
