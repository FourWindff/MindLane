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

export function MindmapContextMenu({
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
    { label: 'Child topic', onClick: onAddChild, disabled: aiBusy },
    { label: 'Add parent node', onClick: onAddParent, disabled: !canAddParent || aiBusy },
    {
      label: 'Insert sibling above',
      onClick: () => onAddSibling('above'),
      disabled: !canAddSibling || aiBusy,
    },
    {
      label: 'Insert sibling below',
      onClick: () => onAddSibling('below'),
      disabled: !canAddSibling || aiBusy,
    },
    {
      label: 'Insert sibling (at end)',
      onClick: () => onAddSibling('end'),
      disabled: !canAddSibling || aiBusy,
    },
    { label: 'Insert image', onClick: () => onInsertImage?.(), disabled: !onInsertImage || aiBusy },
    { label: 'Delete', onClick: onRemove, disabled: !canRemove || aiBusy, modifier: 'danger' },
    ...(menu.scope === 'node'
      ? ([
          'separator',
          {
            label: `Generate memory palace${selectedCount > 1 ? ` (${selectedCount} nodes)` : ''}`,
            onClick: () => onGeneratePalace?.(),
            disabled: !onGeneratePalace || aiBusy || !palaceEnabled,
            modifier: 'accent',
            title: palaceEnabled ? undefined : 'Chat model configuration required',
          },
        ] as MenuEntry[])
      : []),
    'separator',
    { label: 'Reset', onClick: onReset, disabled: aiBusy, modifier: 'muted' },
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
      aria-label="Mindmap menu"
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
