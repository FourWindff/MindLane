import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { TextPromptDialog } from '@/features/workspace/components/TextPromptDialog'
import { displayFileName } from '@/shared/lib/displayFileName'
import { useWorkspaceStore } from '../store'
import { FileContextMenu } from './FileContextMenu'
import { ConfirmDialog } from './ConfirmDialog'
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

/** Renaming a file shows its name without the `.mindlane` extension; folders keep theirs. */
function renameInitialValue(entry: WorkspaceTreeEntry): string {
  return entry.type === 'file' ? displayFileName(entry.name) : entry.name
}

export function FileManager({ isOpen, onClose }: FileManagerProps) {
  const busy = useWorkspaceStore((s) => s.busy)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const tree = useWorkspaceStore((s) => s.tree)
  const lastError = useWorkspaceStore((s) => s.lastError)
  const clearError = useWorkspaceStore((s) => s.clearError)
  const switchWorkspace = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const refreshWorkspaceFiles = useWorkspaceStore((s) => s.refreshWorkspaceFiles)
  const createMindLaneFile = useWorkspaceStore((s) => s.createMindLaneFile)
  const createSubfolder = useWorkspaceStore((s) => s.createSubfolder)
  const deleteItem = useWorkspaceStore((s) => s.deleteItem)
  const renameItem = useWorkspaceStore((s) => s.renameItem)
  const openWorkspaceFile = useWorkspaceStore((s) => s.openWorkspaceFile)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ scope: 'closed' })
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' })
  const [navigationPath, setNavigationPath] = useState<string[]>([])

  // One walk of the tree resolves both the items and the breadcrumb path.
  const { items: currentLevelItems, path: currentDirectoryPath } = useMemo((): {
    items: WorkspaceTreeEntry[]
    path: string | null
  } => {
    let current = tree
    let currentPath = workspacePath ?? null
    for (const segment of navigationPath) {
      const found = current.find((e) => e.name === segment && e.type === 'directory')
      if (!found?.children) return { items: [], path: null }
      currentPath = found.path
      current = found.children
    }
    return { items: current, path: currentPath }
  }, [tree, workspacePath, navigationPath])
  const currentFolder = navigationPath.length > 0 ? navigationPath[navigationPath.length - 1] : null

  const handleContextMenu = useCallback((e: MouseEvent, entry: WorkspaceTreeEntry | null) => {
    e.preventDefault()
    const { clientX: x, clientY: y } = e
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
          const parentPath = entry?.type === 'directory' ? entry.path : currentDirectoryPath
          if (!parentPath) return
          setDialog({ type: 'new-file', parentPath })
          break
        }
        case 'new-folder': {
          const parentPath = entry?.type === 'directory' ? entry.path : currentDirectoryPath
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
    const ok = await createMindLaneFile(name, dialog.parentPath)
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

  const handleNavigateInto = useCallback(
    (entry: WorkspaceTreeEntry) => {
      if (entry.type === 'directory') {
        setNavigationPath((prev) => [...prev, entry.name])
      } else {
        void openWorkspaceFile(entry.path)
        onClose()
      }
    },
    [openWorkspaceFile, onClose],
  )

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
          <TextPromptDialog
            label="New file"
            title="File name"
            subtitle="It is saved to the current workspace right away."
            placeholder="e.g. Today's summary"
            confirmLabel="Create file"
            onConfirm={(name) => void handleNewFile(name)}
            onCancel={closeDialog}
          />
        )}

        {dialog.type === 'new-folder' && (
          <TextPromptDialog
            label="New folder"
            title="Folder name"
            placeholder="e.g. Study notes"
            confirmLabel="Create folder"
            onConfirm={(name) => void handleNewFolder(name)}
            onCancel={closeDialog}
          />
        )}

        {dialog.type === 'rename' && (
          <TextPromptDialog
            label="Rename"
            title={dialog.entry.type === 'file' ? 'Rename file' : 'Rename folder'}
            initialValue={renameInitialValue(dialog.entry)}
            selectInitial
            placeholder={dialog.entry.type === 'file' ? 'File name' : 'Folder name'}
            canSubmit={(value) => value !== renameInitialValue(dialog.entry)}
            onConfirm={(newName) => void handleRename(newName)}
            onCancel={closeDialog}
          />
        )}

        {dialog.type === 'delete' && (
          <ConfirmDialog
            title={dialog.entry.type === 'file' ? 'Delete file' : 'Delete folder'}
            message={`Move "${dialog.entry.name}" to the Trash? ${
              dialog.entry.type === 'directory'
                ? 'Everything inside this folder will be moved to the Trash as well.'
                : ''
            }`}
            confirmLabel="Move to Trash"
            danger
            onConfirm={() => void handleDelete()}
            onCancel={closeDialog}
          />
        )}
      </div>
    </div>
  )
}
