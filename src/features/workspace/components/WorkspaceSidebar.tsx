import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { useWorkspaceStore } from '../store'
import { CreateMindlaneFileButton } from './CreateMindlaneFileButton'

function IconSettings() {
  return (
    <svg className="workspace-sidebar__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M10 3.5l1.2.3.7 1.6 1.7.3 1.2 1.3-.5 1.7 1 1.4-1 1.4.5 1.7-1.2 1.3-1.7.3-.7 1.6-1.2.3-1.2-.3-.7-1.6-1.7-.3-1.2-1.3.5-1.7-1-1.4 1-1.4-.5-1.7 1.2-1.3 1.7-.3.7-1.6L10 3.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function IconFolderSwitch() {
  return (
    <svg className="workspace-sidebar__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M3 5.5h5l1.5 2H17v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 14.5v-9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 10H16M14 7.5l2.5 2.5L14 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconAddFile() {
  return (
    <svg className="workspace-sidebar__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M6 3.5h5.5L15 7v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-11a1 1 0 011-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 3.5V7H15M10 9.5v5M7.5 12h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconRefresh() {
  return (
    <svg className="workspace-sidebar__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M16 9.5A6.5 6.5 0 119 4.2V2.5M9 2.5L6 5.5M9 2.5l3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function workspaceName(workspacePath: string | null): string {
  if (!workspacePath) return '未打开仓库'
  const normalizedPath = workspacePath.replace(/\\/g, '/')
  const parts = normalizedPath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? workspacePath
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function WorkspaceSidebar({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const busy = useWorkspaceStore((s) => s.busy)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const files = useWorkspaceStore((s) => s.files)
  const lastError = useWorkspaceStore((s) => s.lastError)
  const clearError = useWorkspaceStore((s) => s.clearError)
  const switchWorkspace = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const refreshWorkspaceFiles = useWorkspaceStore((s) => s.refreshWorkspaceFiles)
  const openWorkspaceFile = useWorkspaceStore((s) => s.openWorkspaceFile)
  const currentFilePath = useMindmapStore((s) => s.filePath)

  return (
    <aside className="workspace-sidebar">
      <div className="workspace-sidebar__header">
        <div>
          <div className="workspace-sidebar__label">当前仓库</div>
          <div className="workspace-sidebar__title">{workspaceName(workspacePath)}</div>
        </div>
        <div className="workspace-sidebar__header-actions">
          {onOpenSettings && (
            <button
              type="button"
              className="workspace-sidebar__switch workspace-sidebar__icon-btn"
              onClick={onOpenSettings}
              disabled={busy}
              title="打开设置"
              aria-label="打开设置"
            >
              <IconSettings />
            </button>
          )}
          <button
            type="button"
            className="workspace-sidebar__switch workspace-sidebar__icon-btn"
            onClick={() => void switchWorkspace()}
            disabled={busy}
            title="切换仓库"
            aria-label="切换仓库"
          >
            <IconFolderSwitch />
          </button>
        </div>
      </div>

      <div className="workspace-sidebar__path" title={workspacePath ?? undefined}>
        {workspacePath ?? '未打开工作目录'}
      </div>

      <div className="workspace-sidebar__tools">
        <span className="workspace-sidebar__count">{files.length} 个文档</span>
        <div className="workspace-sidebar__tool-actions">
          <CreateMindlaneFileButton
            label="新建"
            className="workspace-sidebar__refresh workspace-sidebar__icon-btn"
            disabled={busy || !workspacePath}
            title="新建文件"
            ariaLabel="新建文件"
          >
            <IconAddFile />
          </CreateMindlaneFileButton>
          <button
            type="button"
            className="workspace-sidebar__refresh workspace-sidebar__icon-btn"
            onClick={() => void refreshWorkspaceFiles()}
            disabled={busy || !workspacePath}
            title="刷新文件列表"
            aria-label="刷新文件列表"
          >
            <IconRefresh />
          </button>
        </div>
      </div>

      {lastError && (
        <div className="workspace-sidebar__error" role="alert">
          <span>{lastError}</span>
          <button type="button" className="workspace-sidebar__error-close" onClick={clearError}>
            关闭
          </button>
        </div>
      )}

      <div className="workspace-sidebar__files">
        {files.length > 0 ? (
          files.map((file) => (
            <button
              key={file.filePath}
              type="button"
              className={`workspace-sidebar__file${currentFilePath === file.filePath ? ' workspace-sidebar__file--active' : ''}`}
              onClick={() => void openWorkspaceFile(file.filePath)}
              disabled={busy}
            >
              <span className="workspace-sidebar__file-name">{file.name}</span>
              <span className="workspace-sidebar__file-meta">{formatTimestamp(file.lastModifiedAt)}</span>
            </button>
          ))
        ) : (
          <div className="workspace-sidebar__empty">
            当前目录暂无 `.mindlane` 文件。你可以先在画布里编辑，然后使用“另存为”保存到这个仓库。
          </div>
        )}
      </div>
    </aside>
  )
}
