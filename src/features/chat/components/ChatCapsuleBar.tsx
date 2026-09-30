import { useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, SwitchCamera } from 'lucide-react'
import {
  deriveChatCapsuleEntries,
  useAiStore,
  type ChatCapsuleEntry,
} from '@/features/chat/model/aiStore'
import { useWorkspaceStore } from '@/features/workspace/store'
import { resolveCapsuleOpenPath } from '@/features/chat/lib/capsuleOpenPath'

import '../styles/chat-capsule-bar.css'

interface ChatCapsuleBarProps {
  expanded: boolean
  onToggleExpand: () => void
}

export function ChatCapsuleBar({ expanded, onToggleExpand }: ChatCapsuleBarProps) {
  const openWorkspaceFile = useWorkspaceStore((s) => s.openWorkspaceFile)
  const currentFileUuid = useAiStore((s) => s.currentFileUuid)
  const setShowSessionList = useAiStore((s) => s.setShowSessionList)
  const fileChats = useAiStore((s) => s.fileChats)
  const filePaths = useAiStore((s) => s.filePaths)
  const fileUuidPaths = useAiStore((s) => s.fileUuidPaths)
  const allSessions = useAiStore((s) => s.allSessions)
  const currentFilePath = useAiStore((s) => s.currentFilePath)

  const entries = useMemo(
    () =>
      deriveChatCapsuleEntries(
        fileChats,
        filePaths,
        fileUuidPaths,
        allSessions,
        currentFileUuid,
        currentFilePath,
      ),
    [fileChats, filePaths, fileUuidPaths, allSessions, currentFileUuid, currentFilePath],
  )

  const handleSelect = useCallback(
    (fileUuid: string) => {
      const filePath = resolveCapsuleOpenPath(fileUuid, fileUuidPaths)
      if (filePath) void openWorkspaceFile(filePath)
    },
    [openWorkspaceFile, fileUuidPaths],
  )

  return (
    <div
      className={`chat-capsule-bar ${expanded ? 'chat-capsule-bar--expanded' : ''}`}
      aria-label="活跃会话"
    >
      <button
        type="button"
        className="chat-capsule-bar__toggle"
        onClick={onToggleExpand}
        title={expanded ? '收起' : '展开'}
        aria-label={expanded ? '收起胶囊条' : '展开胶囊条'}
      >
        {expanded ? (
          <ChevronRight size={14} strokeWidth={2} />
        ) : (
          <ChevronLeft size={14} strokeWidth={2} />
        )}
      </button>
      <div className="chat-capsule-bar__scroll">
        {entries.map((entry) => (
          <Capsule
            key={entry.fileUuid}
            entry={entry}
            current={entry.fileUuid === currentFileUuid}
            onSelect={handleSelect}
            onSwitchSession={() => setShowSessionList(true)}
          />
        ))}
      </div>
    </div>
  )
}

function Capsule({
  entry,
  current,
  onSelect,
  onSwitchSession,
}: {
  entry: ChatCapsuleEntry
  current: boolean
  onSelect: (fileUuid: string) => void
  onSwitchSession: () => void
}) {
  return (
    <button
      type="button"
      className={`chat-capsule chat-capsule--${entry.status} ${current ? 'chat-capsule--current' : ''}`}
      onClick={() => onSelect(entry.fileUuid)}
      title={entry.fileName}
    >
      <span className="chat-capsule__name">{entry.fileName.replace(/\.[^.]+$/, '')}</span>
      {current && (
        <span
          className="chat-capsule__switch"
          role="button"
          title="切换会话"
          aria-label="切换会话"
          onClick={(e) => {
            e.stopPropagation()
            onSwitchSession()
          }}
        >
          <SwitchCamera size={12} strokeWidth={2} />
        </span>
      )}
    </button>
  )
}
