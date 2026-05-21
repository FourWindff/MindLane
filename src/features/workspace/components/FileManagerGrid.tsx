import { Plus, ArrowRight, Folder, FileText } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { WorkspaceTreeEntry } from '../types'

export function FileManagerGrid({
  items,
  busy,
  workspacePath,
  navigationPath,
  onNavigateInto,
  onContextMenu,
  onNewFile,
}: {
  items: WorkspaceTreeEntry[]
  busy: boolean
  workspacePath: string | null
  navigationPath: string[]
  onNavigateInto: (entry: WorkspaceTreeEntry) => void
  onContextMenu: (e: MouseEvent, entry: WorkspaceTreeEntry | null) => void
  onNewFile: () => void
}) {
  return (
    <div className="file-manager__scroll">
      <div
        className="file-manager__grid"
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e, null)
        }}
      >
        {items.map((entry) => {
          const isFolder = entry.type === 'directory'
          const displayName = isFolder ? entry.name : entry.name.replace(/\.mindlane$/, '')
          const childCount = isFolder ? (entry.children?.length ?? 0) : 0

          return (
            <button
              key={entry.path}
              type="button"
              className={`file-manager__card${isFolder ? ' file-manager__card--folder' : ''}`}
              onClick={() => onNavigateInto(entry)}
              onContextMenu={(e) => {
                e.stopPropagation()
                onContextMenu(e, entry)
              }}
              disabled={busy}
            >
              <div className="file-manager__card-visual">
                {isFolder ? (
                  <Folder
                    size={40}
                    className="file-manager__card-icon file-manager__card-icon--folder"
                    strokeWidth={1.5}
                  />
                ) : entry.previewUrl ? (
                  <img
                    src={entry.previewUrl}
                    alt={displayName}
                    className="file-manager__card-preview"
                    draggable={false}
                  />
                ) : (
                  <FileText
                    size={40}
                    className="file-manager__card-icon file-manager__card-icon--file"
                    strokeWidth={1.5}
                  />
                )}
              </div>

              <div className="file-manager__card-info">
                <p className="file-manager__card-meta">
                  {isFolder
                    ? `Collection • ${childCount} Items`
                    : entry.lastModifiedAt.split('T')[0]}
                </p>
                <h3
                  className={`file-manager__card-name${
                    isFolder ? ' file-manager__card-name--folder' : ''
                  }`}
                >
                  {displayName}
                </h3>
              </div>

              <div className="file-manager__card-hint">
                {isFolder ? '展开聚落' : '继续构思'}
                <ArrowRight size={12} />
              </div>

              {isFolder && <div className="file-manager__card-accent" />}
            </button>
          )
        })}

        {navigationPath.length === 0 && (
          <button
            type="button"
            className="file-manager__new-card"
            onClick={onNewFile}
            disabled={busy || !workspacePath}
          >
            <div className="file-manager__new-card-icon">
              <Plus size={22} />
            </div>
            <div className="file-manager__new-card-text">
              <span className="file-manager__new-card-label">新建聚落</span>
              <span className="file-manager__new-card-sublabel">Initialization</span>
            </div>
          </button>
        )}

        {items.length === 0 && workspacePath && (
          <div className="file-manager__empty">
            当前目录暂无内容。右键新建文件或文件夹。
          </div>
        )}

        {!workspacePath && (
          <div className="file-manager__empty">
            未打开工作区。点击切换仓库按钮选择目录。
          </div>
        )}
      </div>
    </div>
  )
}
