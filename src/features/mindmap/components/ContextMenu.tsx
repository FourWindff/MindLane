import { ContextMenu, type MenuEntry } from '@/shared/components/ContextMenu'

export type ContextMenuState =
  { scope: 'closed' } | { clientX: number; clientY: number; scope: 'node'; nodeId: string }

type ContextMenuProps = {
  menu: ContextMenuState
  onClose: () => void
  onAddChild: () => void
  onAddSibling: (mode: 'above' | 'below' | 'end') => void
  onAddParent: () => void
  onRemove: () => void
  onReset: () => void
  onGeneratePalace: () => void
  onInsertImage: () => void
  canAddSibling: boolean
  canAddParent: boolean
  canRemove: boolean
  aiBusy: boolean
  selectedCount: number
  palaceEnabled: boolean
}

export function MindmapContextMenu({
  menu,
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
    { label: 'Insert image', onClick: onInsertImage, disabled: aiBusy },
    { label: 'Delete', onClick: onRemove, disabled: !canRemove || aiBusy, modifier: 'danger' },
    'separator',
    {
      label: `Generate memory palace${selectedCount > 1 ? ` (${selectedCount} nodes)` : ''}`,
      onClick: onGeneratePalace,
      disabled: aiBusy || !palaceEnabled,
      modifier: 'accent',
      title: palaceEnabled ? undefined : 'Chat model configuration required',
    },
    'separator',
    { label: 'Reset', onClick: onReset, disabled: aiBusy, modifier: 'muted' },
  ]

  return (
    <ContextMenu
      x={menu.clientX}
      y={menu.clientY}
      className="mindmap-ctx"
      ariaLabel="Mindmap menu"
      items={items}
      onClose={onClose}
    />
  )
}
