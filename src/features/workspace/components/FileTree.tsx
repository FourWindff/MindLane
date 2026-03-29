import type { MouseEvent } from 'react'
import { ChevronRight, Folder, FolderOpen, File } from 'lucide-react'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { useWorkspaceStore } from '../store'
import type { WorkspaceTreeEntry } from '../types'

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
        {isFolder && <ChevronRight className={`file-tree__chevron${isExpanded ? ' file-tree__chevron--open' : ''}`} size={14} strokeWidth={1.5} />}
        {!isFolder && <span className="file-tree__chevron-placeholder" />}
        {isFolder ? (isExpanded ? <FolderOpen className="file-tree__icon" size={16} strokeWidth={1.4} /> : <Folder className="file-tree__icon" size={16} strokeWidth={1.4} />) : <File className="file-tree__icon" size={16} strokeWidth={1.4} />}
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
