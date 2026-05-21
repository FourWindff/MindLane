import { useCallback, useState, type MouseEvent } from 'react'
import {
  Plus,
  ChevronRight,
  ArrowRight,
} from 'lucide-react'
import { useWorkspaceStore } from '../store'
import { FileContextMenu } from './FileContextMenu'
import { RenameDialog } from './RenameDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { InputDialog } from './InputDialog'
import { FileManagerToolbar } from './FileManagerToolbar'
import type { WorkspaceTreeEntry } from '../types'
import '../file-manager.css'

interface FileManagerProps {
  isOpen: boolean
  onClose: () => void
  onOpenSettings?: () => void
}

function countEntries(entries: WorkspaceTreeEntry[]): { files: number; folders: number } {
  let files = 0
  let folders = 0
  for (const e of entries) {
    if (e.type === 'file') files++
    else {
      folders++
      if (e.children) {
        const sub = countEntries(e.children)
        files += sub.files
        folders += sub.folders
      }
    }
  }
  return { files, folders }
}

type DialogState =
  | { type: 'none' }
  | { type: 'new-file'; parentPath: string }
  | { type: 'new-folder'; parentPath: string }
  | { type: 'rename'; entry: WorkspaceTreeEntry }
  | { type: 'delete'; entry: WorkspaceTreeEntry }

type ContextMenuState = {
  x: number
  y: number
  entry: WorkspaceTreeEntry | null
} | null

export function FileManager({ isOpen, onClose, onOpenSettings }: FileManagerProps) {
  const busy = useWorkspaceStore((s) => s.busy)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const tree = useWorkspaceStore((s) => s.tree)
  const lastError = useWorkspaceStore((s) => s.lastError)
  const clearError = useWorkspaceStore((s) => s.clearError)
  const switchWorkspace = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const refreshWorkspaceFiles = useWorkspaceStore((s) => s.refreshWorkspaceFiles)
  const createMindlaneFile = useWorkspaceStore((s) => s.createMindlaneFile)
  const createSubfolder = useWorkspaceStore((s) => s.createSubfolder)
  const deleteItem = useWorkspaceStore((s) => s.deleteItem)
  const renameItem = useWorkspaceStore((s) => s.renameItem)
  const openWorkspaceFile = useWorkspaceStore((s) => s.openWorkspaceFile)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' })
  const [navigationPath, setNavigationPath] = useState<string[]>([])

  countEntries(tree)

  // Build flat list of current-level items based on navigation path
  const getCurrentLevelItems = useCallback((): WorkspaceTreeEntry[] => {
    if (navigationPath.length === 0) return tree
    let current = tree
    for (const segment of navigationPath) {
      const found = current.find((e) => e.name === segment && e.type === 'directory')
      if (found?.children) {
        current = found.children
      } else {
        return []
      }
    }
    return current
  }, [tree, navigationPath])

  const currentLevelItems = getCurrentLevelItems()
  const currentFolder = navigationPath.length > 0 ? navigationPath[navigationPath.length - 1] : null

  const handleContextMenu = useCallback((e: MouseEvent, entry: WorkspaceTreeEntry | null) => {
    e.preventDefault()
    const container = (e.currentTarget as HTMLElement).closest('.file-manager__grid')
    const rect = container?.getBoundingClientRect() ?? { left: 0, top: 0 }
    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      entry,
    })
  }, [])

  const handleContextAction = useCallback(
    (action: string, entry: WorkspaceTreeEntry | null) => {
      if (!workspacePath) return
      switch (action) {
        case 'open':
          if (entry?.type === 'file') void openWorkspaceFile(entry.path)
          break
        case 'new-file': {
          const parentPath = entry?.type === 'directory'
            ? entry.path
            : workspacePath
          setDialog({ type: 'new-file', parentPath })
          break
        }
        case 'new-folder': {
          const parentPath = entry?.type === 'directory'
            ? entry.path
            : workspacePath
          setDialog({ type: 'new-folder', parentPath })
          break
        }
        case 'rename':
          if (entry) setDialog({ type: 'rename', entry })
          break
        case 'delete':
          if (entry) setDialog({ type: 'delete', entry })
          break
      }
    },
    [workspacePath, openWorkspaceFile],
  )

  const closeDialog = () => setDialog({ type: 'none' })

  const handleNewFile = async (name: string) => {
    if (dialog.type !== 'new-file') return
    const ok = await createMindlaneFile(name, dialog.parentPath)
    if (ok) closeDialog()
  }

  const handleNewFolder = async (name: string) => {
    if (dialog.type !== 'new-folder') return
    const ok = await createSubfolder(dialog.parentPath, name)
    if (ok) closeDialog()
  }

  const handleRename = async (newName: string) => {
    if (dialog.type !== 'rename') return
    const result = await renameItem(dialog.entry.path, newName)
    if (result) closeDialog()
  }

  const handleDelete = async () => {
    if (dialog.type !== 'delete') return
    const ok = await deleteItem(dialog.entry.path)
    if (ok) closeDialog()
  }

  const handleNavigateInto = (entry: WorkspaceTreeEntry) => {
    if (entry.type === 'directory') {
      setNavigationPath([...navigationPath, entry.name])
    } else {
      void openWorkspaceFile(entry.path)
      onClose()
    }
  }

  const handleBreadcrumbClick = (idx: number) => {
    setNavigationPath(navigationPath.slice(0, idx + 1))
  }

  const handleClose = () => {
    onClose()
    setNavigationPath([])
  }

  const handleToolbarNewFile = () => {
    if (!workspacePath) return
    setDialog({ type: 'new-file', parentPath: workspacePath })
  }

  const handleToolbarNewFolder = () => {
    if (!workspacePath) return
    setDialog({ type: 'new-folder', parentPath: workspacePath })
  }

  if (!isOpen) return null

  return (
    <div className="file-manager__backdrop">
      <div className="file-manager__panel">
        <div className="file-manager__gradient" />

        {/* Header */}
        <div className="file-manager__header">
          <div className="file-manager__header-left">
            <div className="file-manager__breadcrumb">
              <button
                type="button"
                className="file-manager__breadcrumb-root"
                onClick={() => setNavigationPath([])}
              >
                思想聚落
              </button>
              {navigationPath.map((name, idx) => (
                <div key={name} className="file-manager__breadcrumb-segment">
                  <ChevronRight className="file-manager__breadcrumb-chevron" size={18} />
                  <button
                    type="button"
                    className="file-manager__breadcrumb-link"
                    onClick={() => handleBreadcrumbClick(idx)}
                  >
                    {name}
                  </button>
                </div>
              ))}
            </div>
            <p className="file-manager__subtitle">
              {currentFolder
                ? `Scanning Cluster: ${currentFolder}`
                : 'Neural Projection of consciousness'}
            </p>
          </div>

          <FileManagerToolbar
            busy={busy}
            workspacePath={workspacePath}
            onNewFile={handleToolbarNewFile}
            onNewFolder={handleToolbarNewFolder}
            onRefresh={() => void refreshWorkspaceFiles()}
            onOpenSettings={onOpenSettings}
            onSwitchWorkspace={() => void switchWorkspace()}
            onClose={handleClose}
          />
        </div>

        {lastError && (
          <div className="file-manager__error" role="alert">
            <span>{lastError}</span>
            <button type="button" className="file-manager__error-close" onClick={clearError}>
              关闭
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="file-manager__scroll">
          <div
            className="file-manager__grid"
            onContextMenu={(e) => {
              e.preventDefault()
              handleContextMenu(e, null)
            }}
          >
            {currentLevelItems.map((entry) => {
              const isFolder = entry.type === 'directory'
              const displayName = isFolder ? entry.name : entry.name.replace(/\.mindlane$/, '')
              const childCount = isFolder
                ? (entry.children?.length ?? 0)
                : 0

              return (
                <button
                  key={entry.path}
                  type="button"
                  className={`file-manager__card${isFolder ? ' file-manager__card--folder' : ''}`}
                  onClick={() => handleNavigateInto(entry)}
                  onContextMenu={(e) => {
                    e.stopPropagation()
                    handleContextMenu(e, entry)
                  }}
                  disabled={busy}
                >
                  {/* Card visual */}
                  <div className="file-manager__card-visual">
                    {isFolder ? (
                      <>
                        <div className="file-manager__card-glow file-manager__card-glow--folder" />
                        <div className="file-manager__card-dots">
                          <div className="file-manager__card-dot file-manager__card-dot--1" />
                          <div className="file-manager__card-dot file-manager__card-dot--2" />
                          <div className="file-manager__card-dot file-manager__card-dot--3" />
                        </div>
                      </>
                    ) : entry.previewUrl ? (
                      <img
                        src={entry.previewUrl}
                        alt={displayName}
                        className="file-manager__card-preview"
                        draggable={false}
                      />
                    ) : (
                      <>
                        <div className="file-manager__card-glow file-manager__card-glow--file" />
                        <div className="file-manager__card-dots">
                          <div className="file-manager__card-dot file-manager__card-dot--center" />
                          <div className="file-manager__card-dot file-manager__card-dot--orbit" />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Card info */}
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

                  {/* Hover hint */}
                  <div className="file-manager__card-hint">
                    {isFolder ? '展开聚落' : '继续构思'}
                    <ArrowRight size={12} />
                  </div>

                  {/* Folder bottom accent */}
                  {isFolder && (
                    <div className="file-manager__card-accent" />
                  )}
                </button>
              )
            })}

            {/* New cluster button (only at root level) */}
            {navigationPath.length === 0 && (
              <button
                type="button"
                className="file-manager__new-card"
                onClick={handleToolbarNewFile}
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

            {currentLevelItems.length === 0 && workspacePath && (
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

        {/* Footer stats */}
        <div className="file-manager__footer">
          <div className="file-manager__footer-divider" />
          <div className="file-manager__stats">
            <div className="file-manager__stat">
              <span className="file-manager__stat-value">{currentLevelItems.length}</span>
              <span className="file-manager__stat-label">Total Clusters</span>
            </div>
            <div className="file-manager__stat-divider" />
            <div className="file-manager__stat">
              <span className="file-manager__stat-value">
                {currentLevelItems.filter((e) => e.type === 'directory').length}
              </span>
              <span className="file-manager__stat-label">Biological Groups</span>
            </div>
            <div className="file-manager__stat-divider" />
            <div className="file-manager__stat">
              <span className="file-manager__stat-value">
                {currentLevelItems.filter((e) => e.type === 'file').length}
              </span>
              <span className="file-manager__stat-label">Neural Nodes</span>
            </div>
          </div>
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <FileContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            entry={contextMenu.entry}
            onAction={handleContextAction}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Dialogs */}
        {dialog.type === 'new-file' && (
          <InputDialog
            label="新建文件"
            title="输入文件名"
            subtitle="创建后会立即保存到当前工作区。"
            placeholder="例如：今日总结"
            confirmLabel="创建文件"
            onConfirm={(name) => void handleNewFile(name)}
            onCancel={closeDialog}
          />
        )}

        {dialog.type === 'new-folder' && (
          <InputDialog
            label="新建文件夹"
            title="输入文件夹名称"
            placeholder="例如：学习笔记"
            confirmLabel="创建文件夹"
            onConfirm={(name) => void handleNewFolder(name)}
            onCancel={closeDialog}
          />
        )}

        {dialog.type === 'rename' && (
          <RenameDialog
            currentName={dialog.entry.name}
            isFile={dialog.entry.type === 'file'}
            onConfirm={(newName) => void handleRename(newName)}
            onCancel={closeDialog}
          />
        )}

        {dialog.type === 'delete' && (
          <ConfirmDialog
            title={dialog.entry.type === 'file' ? '删除文件' : '删除文件夹'}
            message={`确定要将「${dialog.entry.name}」移到回收站吗？${
              dialog.entry.type === 'directory'
                ? '该文件夹内的所有内容都将被移到回收站。'
                : ''
            }`}
            confirmLabel="移到回收站"
            danger
            onConfirm={() => void handleDelete()}
            onCancel={closeDialog}
          />
        )}
      </div>
    </div>
  )
}
