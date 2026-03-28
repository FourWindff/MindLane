import type { MouseEvent } from 'react'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { useWorkspaceStore } from '../store'
import type { WorkspaceTreeEntry } from '../types'

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`file-tree__chevron${open ? ' file-tree__chevron--open' : ''}`}
      viewBox="0 0 16 16"
      aria-hidden
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconFolder({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg className="file-tree__icon" viewBox="0 0 20 20" aria-hidden>
        <path
          d="M3 6.5h14v1H4.5L3 14.5V6.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M3 5.5h5l1.5 1.5H17v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg className="file-tree__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M3 5.5h5l1.5 2H17v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 14.5v-9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconFile() {
  return (
    <svg className="file-tree__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M6 3.5h5.5L15 7v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-11a1 1 0 011-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 3.5V7H15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface FileTreeItemProps {
  entry: WorkspaceTreeEntry
  depth: number
  onContextMenu: (e: MouseEvent, entry: WorkspaceTreeEntry) => void
}

function FileTreeItem({ entry, depth, onContextMenu }: FileTreeItemProps) {
  const busy = useWorkspaceStore((s) => s.busy)
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders)
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder)
  const openWorkspaceFile = useWorkspaceStore((s) => s.openWorkspaceFile)
  const currentFilePath = useMindmapStore((s) => s.filePath)

  const isFolder = entry.type === 'directory'
  const isExpanded = isFolder && expandedFolders.has(entry.path)
  const isActive = !isFolder && currentFilePath === entry.path

  const displayName = isFolder ? entry.name : entry.name.replace(/\.mindlane$/, '')

  const handleClick = () => {
    if (busy) return
    if (isFolder) {
      toggleFolder(entry.path)
    } else {
      void openWorkspaceFile(entry.path)
    }
  }

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, entry)
  }

  return (
    <>
      <button
        type="button"
        className={`file-tree__item${isActive ? ' file-tree__item--active' : ''}${isFolder ? ' file-tree__item--folder' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        disabled={busy}
        title={entry.path}
      >
        {isFolder && <IconChevron open={isExpanded} />}
        {!isFolder && <span className="file-tree__chevron-placeholder" />}
        {isFolder ? <IconFolder open={isExpanded} /> : <IconFile />}
        <span className="file-tree__name">{displayName}</span>
      </button>
      {isFolder && isExpanded && entry.children && (
        <div className="file-tree__children">
          {entry.children.map((child) => (
            <FileTreeItem
              key={child.path}
              entry={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
            />
          ))}
          {entry.children.length === 0 && (
            <div className="file-tree__empty" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>
              空文件夹
            </div>
          )}
        </div>
      )}
    </>
  )
}

interface FileTreeProps {
  tree: WorkspaceTreeEntry[]
  onContextMenu: (e: MouseEvent, entry: WorkspaceTreeEntry | null) => void
}

export function FileTree({ tree, onContextMenu }: FileTreeProps) {
  const handleRootContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    onContextMenu(e, null)
  }

  return (
    <div className="file-tree" onContextMenu={handleRootContextMenu}>
      {tree.length > 0 ? (
        tree.map((entry) => (
          <FileTreeItem
            key={entry.path}
            entry={entry}
            depth={0}
            onContextMenu={onContextMenu}
          />
        ))
      ) : (
        <div className="file-tree__root-empty">
          当前目录暂无 .mindlane 文件。你可以右键新建文件或文件夹。
        </div>
      )}
    </div>
  )
}
