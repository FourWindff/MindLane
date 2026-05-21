import type { RefObject } from 'react'

export type ContextMenuState =
  | { scope: 'closed' }
  | { clientX: number; clientY: number; scope: 'pane' }
  | { clientX: number; clientY: number; scope: 'node'; nodeId: string }

type ContextMenuProps = {
  menu: ContextMenuState
  menuRef: RefObject<HTMLDivElement>
  onClose: () => void
  onAddChild: () => void
  onAddSibling: () => void
  onRemove: () => void
  onReset: () => void
  onGeneratePalace?: () => void
  canAddSibling: boolean
  canRemove: boolean
  aiBusy: boolean
  selectedCount: number
  palaceEnabled: boolean
}

export function MindMapContextMenu({
  menu,
  menuRef,
  onClose,
  onAddChild,
  onAddSibling,
  onRemove,
  onReset,
  onGeneratePalace,
  canAddSibling,
  canRemove,
  aiBusy,
  selectedCount,
  palaceEnabled,
}: ContextMenuProps) {
  if (menu.scope === 'closed') return null

  const run = (fn: () => void) => {
    fn()
    onClose()
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  const menuW = 200
  const menuH = 280
  const left = Math.min(menu.clientX, Math.max(8, vw - menuW - 8))
  const top = Math.min(menu.clientY, Math.max(8, vh - menuH - 8))

  return (
    <div
      ref={menuRef}
      className="mindmap-ctx"
      style={{ left, top }}
      role="menu"
      aria-label="导图菜单"
    >
      <button type="button" className="mindmap-ctx__item" role="menuitem" onClick={() => run(onAddChild)} disabled={aiBusy}>
        子主题
      </button>
      <button
        type="button"
        className="mindmap-ctx__item"
        role="menuitem"
        onClick={() => run(onAddSibling)}
        disabled={!canAddSibling || aiBusy}
      >
        同级
      </button>
      <button
        type="button"
        className="mindmap-ctx__item mindmap-ctx__item--danger"
        role="menuitem"
        onClick={() => run(onRemove)}
        disabled={!canRemove || aiBusy}
      >
        删除
      </button>
      {menu.scope === 'node' && (
        <>
          <div className="mindmap-ctx__sep" role="separator" />
          <button
            type="button"
            className="mindmap-ctx__item mindmap-ctx__item--accent"
            role="menuitem"
            onClick={() => run(() => onGeneratePalace?.())}
            disabled={!onGeneratePalace || aiBusy || !palaceEnabled}
            title={palaceEnabled ? undefined : '当前模型不支持记忆宫殿功能'}
          >
            生成记忆宫殿{selectedCount > 1 ? ` (${selectedCount} 节点)` : ''}
          </button>
        </>
      )}
      <div className="mindmap-ctx__sep" role="separator" />
      <button type="button" className="mindmap-ctx__item mindmap-ctx__item--muted" role="menuitem" onClick={() => run(onReset)} disabled={aiBusy}>
        重置
      </button>
    </div>
  )
}
