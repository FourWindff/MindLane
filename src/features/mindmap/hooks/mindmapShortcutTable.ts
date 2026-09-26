import type { MindmapOperationController } from '@/features/mindmap/model/mindmapOperationController'
import type { ShortcutRow } from '@/shared/shortcuts/useRegisterShortcut'

type MindmapShortcutContext = {
  controller: MindmapOperationController
  selectedId: string | null
  canAddSibling: boolean
  /** 表级总开关：AI 流式期间整组禁用 */
  enabled: () => boolean
  save: () => Promise<void>
}

/**
 * 导图快捷键表：一行 = combo → 一个动作。
 * 表本身每渲染重算，注册侧只靠元信息签名重挂，handler 始终取最新一版表。
 */
export function mindmapShortcutRows({
  controller,
  selectedId,
  canAddSibling,
  enabled,
  save,
}: MindmapShortcutContext): ShortcutRow[] {
  const base = { enabled }
  return [
    ['mindmap.addChild', 'mod+enter', '添加子主题', controller.addChild, base],
    [
      'mindmap.addSibling',
      'mod+shift+enter',
      '添加同级主题',
      () => controller.addSibling(),
      { enabled: () => enabled() && canAddSibling },
    ],
    ['mindmap.delete', 'delete', '删除选中节点（含子树）', controller.removeSelected, base],
    ['mindmap.backspace', 'backspace', '删除选中节点（含子树）', controller.removeSelected, base],
    [
      'mindmap.edit',
      'f2',
      '编辑选中节点',
      () => {
        if (selectedId) controller.startEditing(selectedId)
      },
      base,
    ],
    ['mindmap.reset', 'mod+shift+r', '重置为示例导图', controller.reset, base],
    ['mindmap.navLeft', 'arrowleft', '选中父节点', controller.navigateLeft, base],
    ['mindmap.navRight', 'arrowright', '选中第一个子节点', controller.navigateRight, base],
    ['mindmap.navUp', 'arrowup', '选中上方兄弟节点', controller.navigateUp, base],
    ['mindmap.navDown', 'arrowdown', '选中下方兄弟节点', controller.navigateDown, base],
    ['mindmap.centerRoot', 'mod+0', '回到中心主题', () => void controller.centerRoot(), base],
    ['mindmap.undo', 'mod+z', '撤销', controller.undo, base],
    ['mindmap.redo', 'mod+shift+z', '重做', controller.redo, base],
    ['mindmap.save', 'mod+s', '保存文件', () => void save(), { ...base, preventWhenTyping: false }],
  ]
}
