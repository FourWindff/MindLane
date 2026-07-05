import { useEffect, useRef } from 'react'
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
      { label: '新建文件', key: 'new-file' },
      { label: '新建文件夹', key: 'new-folder' },
    ]
  }
  if (entry.type === 'directory') {
    return [
      { label: '新建文件', key: 'new-file' },
      { label: '新建子文件夹', key: 'new-folder' },
      { label: '重命名', key: 'rename' },
      { label: '删除', key: 'delete', danger: true },
    ]
  }
  return [
    { label: '打开', key: 'open' },
    { label: '重命名', key: 'rename' },
    { label: '删除', key: 'delete', danger: true },
  ]
}

export function FileContextMenu({ x, y, entry, onAction, onClose }: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const items = getMenuItems(entry)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const parent = menuRef.current.offsetParent as HTMLElement | null
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()

    let adjustedX = x
    let adjustedY = y
    if (rect.right > parentRect.right) {
      adjustedX = Math.max(0, x - (rect.right - parentRect.right))
    }
    if (rect.bottom > parentRect.bottom) {
      adjustedY = Math.max(0, y - (rect.bottom - parentRect.bottom))
    }
    if (adjustedX !== x || adjustedY !== y) {
      menuRef.current.style.left = `${adjustedX}px`
      menuRef.current.style.top = `${adjustedY}px`
    }
  }, [x, y])

  return (
    <div ref={menuRef} className="context-menu" style={{ left: x, top: y }} role="menu">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
          role="menuitem"
          onClick={() => {
            onAction(item.key, entry)
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
