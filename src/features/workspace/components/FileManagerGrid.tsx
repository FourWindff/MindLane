import { Plus, ArrowRight, Folder, FileText, FolderOpen, HardDrive } from 'lucide-react'
import { useCallback } from 'react'
import type { MouseEvent } from 'react'
import { displayFileName } from '@/shared/lib/displayFileName'
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
  const handleGridContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault()
      onContextMenu(e, null)
    },
    [onContextMenu],
  )

  return (
    <div className="file-manager__scroll">
      <div className="file-manager__grid" onContextMenu={handleGridContextMenu}>
        {items.map((entry) => {
          const isFolder = entry.type === 'directory'
          const displayName = isFolder ? entry.name : displayFileName(entry.name)
          const childCount = isFolder ? (entry.children?.length ?? 0) : 0
          const dateLabel = isFolder ? `${childCount} items` : formatDate(entry.lastModifiedAt)

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
                    size={32}
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
                    size={32}
                    className="file-manager__card-icon file-manager__card-icon--file"
                    strokeWidth={1.5}
                  />
                )}
              </div>

              <div className="file-manager__card-info">
                <p className="file-manager__card-meta">{dateLabel}</p>
                <h3
                  className={`file-manager__card-name${
                    isFolder ? ' file-manager__card-name--folder' : ''
                  }`}
                >
                  {displayName}
                </h3>
              </div>

              <div className="file-manager__card-hint">
                {isFolder ? 'Open' : 'Edit'}
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
              <Plus size={20} strokeWidth={2} />
            </div>
            <div className="file-manager__new-card-text">
              <span className="file-manager__new-card-label">New file</span>
              <span className="file-manager__new-card-sublabel">Create .mindlane</span>
            </div>
          </button>
        )}

        {items.length === 0 && workspacePath && (
          <div className="file-manager__empty">
            <FolderOpen size={28} strokeWidth={1.5} className="file-manager__empty-icon" />
            <p className="file-manager__empty-title">This folder is empty</p>
            <p className="file-manager__empty-desc">
              Right-click the empty area, or use the buttons above, to create a file or folder
            </p>
          </div>
        )}

        {!workspacePath && (
          <div className="file-manager__empty">
            <HardDrive size={28} strokeWidth={1.5} className="file-manager__empty-icon" />
            <p className="file-manager__empty-title">No workspace selected</p>
            <p className="file-manager__empty-desc">
              Use the switch repository button in the top right to pick a directory as your
              workspace
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`

    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  } catch {
    return isoString.split('T')[0].replace(/-/g, '.')
  }
}
