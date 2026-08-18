import type { RefObject } from 'react'

export type ContextMenuState =
  { scope: 'closed' } | { clientX: number; clientY: number; scope: 'node'; nodeId: string }

type ContextMenuProps = {
  menu: ContextMenuState
  menuRef: RefObject<HTMLDivElement>
  onClose: () => void
  onAddChild: () => void
  onAddSibling: (mode: 'above' | 'below' | 'end') => void
  onAddParent: () => void
  onRemove: () => void
  onReset: () => void
  onGeneratePalace?: () => void
  onInsertImage?: () => void
  canAddSibling: boolean
  canAddParent: boolean
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
  onAddParent,
  onRemove,
  onReset,
  onGeneratePalace,
  onInsertImage,
  canAddSibling,
  canAddParent,
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
  const menuH = 400
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
      <button
        type="button"
        className="mindmap-ctx__item"
        role="menuitem"
        onClick={() => run(onAddChild)}
        disabled={aiBusy}
      >
        子主题
      </button>
      <button
        type="button"
        className="mindmap-ctx__item"
        role="menuitem"
        onClick={() => run(onAddParent)}
        disabled={!canAddParent || aiBusy}
      >
        添加父节点
      </button>
      <button
        type="button"
        className="mindmap-ctx__item"
        role="menuitem"
        onClick={() => run(() => onAddSibling('above'))}
        disabled={!canAddSibling || aiBusy}
      >
        在上面插入同级
      </button>
      <button
        type="button"
        className="mindmap-ctx__item"
        role="menuitem"
        onClick={() => run(() => onAddSibling('below'))}
        disabled={!canAddSibling || aiBusy}
      >
        在下面插入同级
      </button>
      <button
        type="button"
        className="mindmap-ctx__item"
        role="menuitem"
        onClick={() => run(() => onAddSibling('end'))}
        disabled={!canAddSibling || aiBusy}
      >
        插入同级（末尾）
      </button>
      <button
        type="button"
        className="mindmap-ctx__item"
        role="menuitem"
        onClick={() => run(() => onInsertImage?.())}
        disabled={!onInsertImage || aiBusy}
      >
        插入图片
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
      <button
        type="button"
        className="mindmap-ctx__item mindmap-ctx__item--muted"
        role="menuitem"
        onClick={() => run(onReset)}
        disabled={aiBusy}
      >
        重置
      </button>
    </div>
  )
}
