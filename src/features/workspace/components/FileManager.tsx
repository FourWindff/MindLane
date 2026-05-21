import { useCallback, useState, type MouseEvent } from 'react'
import { useWorkspaceStore } from '../store'
import { FileContextMenu } from './FileContextMenu'
import { RenameDialog } from './RenameDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { InputDialog } from './InputDialog'
import { FileManagerToolbar } from './FileManagerToolbar'
import { FileManagerBreadcrumb } from './FileManagerBreadcrumb'
import { FileManagerGrid } from './FileManagerGrid'
import { FileManagerFooter } from './FileManagerFooter'
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
  const handleRefresh = useCallback(() => void refreshWorkspaceFiles(), [refreshWorkspaceFiles])
  const handleSwitchWorkspace = useCallback(() => void switchWorkspace(), [switchWorkspace])

  if (!isOpen) return null

  return (
    <div className="file-manager__backdrop">
      <div className="file-manager__panel">
        <div className="file-manager__gradient" />

        {/* Header */}
        <div className="file-manager__header">
          <FileManagerBreadcrumb
            navigationPath={navigationPath}
            currentFolder={currentFolder}
            lastError={lastError}
            onNavigateRoot={() => setNavigationPath([])}
            onBreadcrumbClick={handleBreadcrumbClick}
            onClearError={clearError}
          />

          <FileManagerToolbar
            busy={busy}
            workspacePath={workspacePath}
            onNewFile={handleToolbarNewFile}
            onNewFolder={handleToolbarNewFolder}
            onRefresh={handleRefresh}
            onOpenSettings={onOpenSettings}
            onSwitchWorkspace={handleSwitchWorkspace}
            onClose={handleClose}
          />
        </div>

        {/* Grid */}
        <FileManagerGrid
          items={currentLevelItems}
          busy={busy}
          workspacePath={workspacePath}
          navigationPath={navigationPath}
          onNavigateInto={handleNavigateInto}
          onContextMenu={handleContextMenu}
          onNewFile={handleToolbarNewFile}
        />

        {/* Footer stats */}
        <FileManagerFooter items={currentLevelItems} />

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
