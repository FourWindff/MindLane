import type { MindmapOperationController } from '@/features/mindmap/model/operationController'
import type { ShortcutRow } from '@/shared/shortcuts/useRegisterShortcut'

type MindmapShortcutContext = {
  controller: MindmapOperationController
  selectedId: string | null
  canAddSibling: boolean
  /** Table-level switch: the whole group is disabled while AI is streaming */
  enabled: () => boolean
  save: () => Promise<void>
}

/**
 * Mindmap shortcut table: one row = combo -> one action.
 * The table itself is recomputed on every render; the registry side only remounts on a metadata
 * signature change, and handlers always read the latest table.
 */
export function shortcutRows({
  controller,
  selectedId,
  canAddSibling,
  enabled,
  save,
}: MindmapShortcutContext): ShortcutRow[] {
  const base = { enabled }
  return [
    ['mindmap.addChild', 'mod+enter', 'Add child topic', controller.addChild, base],
    [
      'mindmap.addSibling',
      'mod+shift+enter',
      'Add sibling topic',
      () => controller.addSibling(),
      { enabled: () => enabled() && canAddSibling },
    ],
    [
      'mindmap.delete',
      'delete',
      'Delete the selected node (with its subtree)',
      controller.removeSelected,
      base,
    ],
    [
      'mindmap.backspace',
      'backspace',
      'Delete the selected node (with its subtree)',
      controller.removeSelected,
      base,
    ],
    [
      'mindmap.edit',
      'f2',
      'Edit the selected node',
      () => {
        if (selectedId) controller.startEditing(selectedId)
      },
      base,
    ],
    ['mindmap.reset', 'mod+shift+r', 'Reset to the sample mindmap', controller.reset, base],
    ['mindmap.navLeft', 'arrowleft', 'Select the parent node', controller.navigateLeft, base],
    [
      'mindmap.navRight',
      'arrowright',
      'Select the first child node',
      controller.navigateRight,
      base,
    ],
    ['mindmap.navUp', 'arrowup', 'Select the sibling above', controller.navigateUp, base],
    ['mindmap.navDown', 'arrowdown', 'Select the sibling below', controller.navigateDown, base],
    [
      'mindmap.centerRoot',
      'mod+0',
      'Back to the central topic',
      () => void controller.centerRoot(),
      base,
    ],
    ['mindmap.undo', 'mod+z', 'Undo', controller.undo, base],
    ['mindmap.redo', 'mod+shift+z', 'Redo', controller.redo, base],
    [
      'mindmap.save',
      'mod+s',
      'Save file',
      () => void save(),
      { ...base, preventWhenTyping: false },
    ],
  ]
}
