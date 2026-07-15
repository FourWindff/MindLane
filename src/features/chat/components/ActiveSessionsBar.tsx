import type { ActiveSessionBarEntry } from '@/features/chat/model/aiStore'

interface ActiveSessionsBarProps {
  entries: ActiveSessionBarEntry[]
  onSelect: (fileUuid: string) => void
}

const statusLabels: Record<ActiveSessionBarEntry['status'], string> = {
  generating: '生成中',
  stopping: '停止中',
  idle: '已完成',
}

export function ActiveSessionsBar({ entries, onSelect }: ActiveSessionsBarProps) {
  if (entries.length === 0) return null
  return (
    <div className="chat-active-sessions" aria-label="其他活跃会话">
      {entries.map((entry) => (
        <button
          key={entry.fileUuid}
          type="button"
          className={`chat-active-session chat-active-session--${entry.status}`}
          onClick={() => onSelect(entry.fileUuid)}
        >
          <span className="chat-active-session__name">{entry.fileName}</span>
          <span className="chat-active-session__status">{statusLabels[entry.status]}</span>
        </button>
      ))}
    </div>
  )
}
