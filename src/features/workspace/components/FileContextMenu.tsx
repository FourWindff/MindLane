import { ContextMenu, type MenuEntry } from '@/shared/components/ContextMenu'
import type { WorkspaceTreeEntry } from '../types'

interface ContextMenuAction {
  label: string
  key: string
  danger?: boolean
}

interface FileContextMenuProps {
  x: number
  y: number
  entry: WorkspaceTreeEntry | null
  onAction: (action: string, entry: WorkspaceTreeEntry | null) => void
  onClose: () => void
}

function getMenuItems(entry: WorkspaceTreeEntry | null): ContextMenuAction[] {
  if (!entry) {
    return [
      { label: 'New file', key: 'new-file' },
      { label: 'New folder', key: 'new-folder' },
    ]
  }
  if (entry.type === 'directory') {
    return [
      { label: 'New file', key: 'new-file' },
      { label: 'New subfolder', key: 'new-folder' },
      { label: 'Rename', key: 'rename' },
      { label: 'Delete', key: 'delete', danger: true },
    ]
  }
  return [
    { label: 'Open', key: 'open' },
    { label: 'Rename', key: 'rename' },
    { label: 'Delete', key: 'delete', danger: true },
  ]
}

export function FileContextMenu({ x, y, entry, onAction, onClose }: FileContextMenuProps) {
  const items: MenuEntry[] = getMenuItems(entry).map((item) => ({
    label: item.label,
    onClick: () => onAction(item.key, entry),
    disabled: false,
    modifier: item.danger ? 'danger' : undefined,
  }))

  return (
    <ContextMenu
      x={x}
      y={y}
      className="context-menu"
      ariaLabel="File menu"
      items={items}
      onClose={onClose}
    />
  )
}
