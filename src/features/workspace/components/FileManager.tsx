import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useWorkspaceStore } from '../store'
import { FileContextMenu } from './FileContextMenu'
import { RenameDialog } from './RenameDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { InputDialog } from './InputDialog'
import { FileManagerToolbar } from './FileManagerToolbar'
import { FileManagerBreadcrumb } from './FileManagerBreadcrumb'
import { FileManagerGrid } from './FileManagerGrid'
import type { WorkspaceTreeEntry } from '../types'
import '../file-manager.css'

interface FileManagerProps {
  isOpen: boolean
  onClose: () => void
}

type DialogState =
  | { type: 'none' }
  | { type: 'new-file'; parentPath: string }
  | { type: 'new-folder'; parentPath: string }
  | { type: 'rename'; entry: WorkspaceTreeEntry }
  | { type: 'delete'; entry: WorkspaceTreeEntry }

type ContextMenuState =
  | { scope: 'closed' }
  | { scope: 'empty'; x: number; y: number }
  | { scope: 'entry'; x: number; y: number; entry: WorkspaceTreeEntry }

export function FileManager({ isOpen, onClose }: FileManagerProps) {
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

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ scope: 'closed' })
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' })
  const [navigationPath, setNavigationPath] = useState<string[]>([])

  const currentLevelItems = useMemo((): WorkspaceTreeEntry[] => {
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
  const currentFolder = navigationPath.length > 0 ? navigationPath[navigationPath.length - 1] : null
  const currentDirectoryPath = useMemo((): string | null => {
    if (!workspacePath) return null
    if (navigationPath.length === 0) return workspacePath

    let current = tree
    let currentPath = workspacePath
    for (const segment of navigationPath) {
      const found = current.find((e) => e.name === segment && e.type === 'directory')
      if (!found?.children) return null
      currentPath = found.path
      current = found.children
    }
    return currentPath
  }, [tree, workspacePath, navigationPath])

  const handleContextMenu = useCallback((e: MouseEvent, entry: WorkspaceTreeEntry | null) => {
    e.preventDefault()
    const container = (e.currentTarget as HTMLElement).closest('.file-manager__grid')
    const rect = container?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (entry) {
      setContextMenu({ scope: 'entry', x, y, entry })
    } else {
      setContextMenu({ scope: 'empty', x, y })
    }
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
            : currentDirectoryPath
          if (!parentPath) return
          setDialog({ type: 'new-file', parentPath })
          break
        }
        case 'new-folder': {
          const parentPath = entry?.type === 'directory'
            ? entry.path
            : currentDirectoryPath
          if (!parentPath) return
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
    [workspacePath, currentDirectoryPath, openWorkspaceFile],
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

  const handleNavigateInto = useCallback((entry: WorkspaceTreeEntry) => {
    if (entry.type === 'directory') {
      setNavigationPath((prev) => [...prev, entry.name])
    } else {
      void openWorkspaceFile(entry.path)
      onClose()
    }
  }, [openWorkspaceFile, onClose])

  const handleBreadcrumbClick = useCallback((idx: number) => {
    setNavigationPath((prev) => prev.slice(0, idx + 1))
  }, [])

  const handleClose = useCallback(() => {
    onClose()
    setNavigationPath([])
  }, [onClose])

  const handleToolbarNewFile = useCallback(() => {
    if (!currentDirectoryPath) return
    setDialog({ type: 'new-file', parentPath: currentDirectoryPath })
  }, [currentDirectoryPath])

  const handleToolbarNewFolder = useCallback(() => {
    if (!currentDirectoryPath) return
    setDialog({ type: 'new-folder', parentPath: currentDirectoryPath })
  }, [currentDirectoryPath])

  if (!isOpen) return null

  return (
    <div className="file-manager__backdrop">
      <div className="file-manager__panel">
        <div className="file-manager__gradient" />

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
            onRefresh={() => void refreshWorkspaceFiles()}
            onSwitchWorkspace={() => void switchWorkspace()}
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

        {/* Context Menu */}
        {contextMenu.scope !== 'closed' && (
          <FileContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            entry={contextMenu.scope === 'entry' ? contextMenu.entry : null}
            onAction={handleContextAction}
            onClose={() => setContextMenu({ scope: 'closed' })}
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
