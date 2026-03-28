import { useCallback, useState, type MouseEvent } from 'react'
import { useWorkspaceStore } from '../store'
import { FileTree } from './FileTree'
import { FileContextMenu } from './FileContextMenu'
import { RenameDialog } from './RenameDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { InputDialog } from './InputDialog'
import type { WorkspaceTreeEntry } from '../types'

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

function IconAddFolder() {
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
        d="M10 9.5v4M8 11.5h4"
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

export function WorkspaceSidebar({ onOpenSettings }: { onOpenSettings?: () => void }) {
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

  const { files: fileCount, folders: folderCount } = countEntries(tree)

  const handleContextMenu = useCallback((e: MouseEvent, entry: WorkspaceTreeEntry | null) => {
    e.preventDefault()
    const sidebar = (e.currentTarget as HTMLElement).closest('.workspace-sidebar')
    const rect = sidebar?.getBoundingClientRect() ?? { left: 0, top: 0 }
    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      entry,
    })
  }, [])

  const handleContextAction = useCallback((action: string, entry: WorkspaceTreeEntry | null) => {
    if (!workspacePath) return

    switch (action) {
      case 'open':
        if (entry?.type === 'file') void openWorkspaceFile(entry.path)
        break
      case 'new-file': {
        const parentPath = entry?.type === 'directory' ? entry.path : workspacePath
        setDialog({ type: 'new-file', parentPath })
        break
      }
      case 'new-folder': {
        const parentPath = entry?.type === 'directory' ? entry.path : workspacePath
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
  }, [workspacePath, openWorkspaceFile])

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

  const handleToolbarNewFile = () => {
    if (!workspacePath) return
    setDialog({ type: 'new-file', parentPath: workspacePath })
  }

  const handleToolbarNewFolder = () => {
    if (!workspacePath) return
    setDialog({ type: 'new-folder', parentPath: workspacePath })
  }

  const summaryText = folderCount > 0
    ? `${fileCount} 个文件 · ${folderCount} 个文件夹`
    : `${fileCount} 个文档`

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
        <span className="workspace-sidebar__count">{summaryText}</span>
        <div className="workspace-sidebar__tool-actions">
          <button
            type="button"
            className="workspace-sidebar__refresh workspace-sidebar__icon-btn"
            onClick={handleToolbarNewFile}
            disabled={busy || !workspacePath}
            title="新建文件"
            aria-label="新建文件"
          >
            <IconAddFile />
          </button>
          <button
            type="button"
            className="workspace-sidebar__refresh workspace-sidebar__icon-btn"
            onClick={handleToolbarNewFolder}
            disabled={busy || !workspacePath}
            title="新建文件夹"
            aria-label="新建文件夹"
          >
            <IconAddFolder />
          </button>
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
        <FileTree tree={tree} onContextMenu={handleContextMenu} />
      </div>

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

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
          message={`确定要将「${dialog.entry.name}」移到回收站吗？${dialog.entry.type === 'directory' ? '该文件夹内的所有内容都将被移到回收站。' : ''}`}
          confirmLabel="移到回收站"
          danger
          onConfirm={() => void handleDelete()}
          onCancel={closeDialog}
        />
      )}
    </aside>
  )
}
