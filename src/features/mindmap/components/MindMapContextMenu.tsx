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

type MenuItem = {
  label: string
  onClick: () => void
  disabled: boolean
  modifier?: 'danger' | 'accent' | 'muted'
  title?: string
}

/** The menu's content: plain items, separated by rules. */
type MenuEntry = MenuItem | 'separator'

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

  const items: MenuEntry[] = [
    { label: '子主题', onClick: onAddChild, disabled: aiBusy },
    { label: '添加父节点', onClick: onAddParent, disabled: !canAddParent || aiBusy },
    {
      label: '在上面插入同级',
      onClick: () => onAddSibling('above'),
      disabled: !canAddSibling || aiBusy,
    },
    {
      label: '在下面插入同级',
      onClick: () => onAddSibling('below'),
      disabled: !canAddSibling || aiBusy,
    },
    {
      label: '插入同级（末尾）',
      onClick: () => onAddSibling('end'),
      disabled: !canAddSibling || aiBusy,
    },
    { label: '插入图片', onClick: () => onInsertImage?.(), disabled: !onInsertImage || aiBusy },
    { label: '删除', onClick: onRemove, disabled: !canRemove || aiBusy, modifier: 'danger' },
    ...(menu.scope === 'node'
      ? ([
          'separator',
          {
            label: `生成记忆宫殿${selectedCount > 1 ? ` (${selectedCount} 节点)` : ''}`,
            onClick: () => onGeneratePalace?.(),
            disabled: !onGeneratePalace || aiBusy || !palaceEnabled,
            modifier: 'accent',
            title: palaceEnabled ? undefined : '需要配置对话模型',
          },
        ] as MenuEntry[])
      : []),
    'separator',
    { label: '重置', onClick: onReset, disabled: aiBusy, modifier: 'muted' },
  ]

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
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="mindmap-ctx__sep" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            className={`mindmap-ctx__item${item.modifier ? ` mindmap-ctx__item--${item.modifier}` : ''}`}
            role="menuitem"
            onClick={() => run(item.onClick)}
            disabled={item.disabled}
            title={item.title}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}
