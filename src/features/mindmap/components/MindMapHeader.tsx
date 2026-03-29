import { ListTree, Columns2, Trash2, RotateCcw, AlignLeft, Save, FolderInput, Settings } from 'lucide-react'

type Props = {
  onAddChild: () => void
  onAddSibling: () => void
  onRemove: () => void
  onReset: () => void
  onOpenSettings?: () => void
  onSwitchWorkspace?: () => void
  onAutoLayout?: () => void
  onSave?: () => void
  canAddSibling: boolean
  canRemove: boolean
}

export function MindMapHeader({
  onAddChild,
  onAddSibling,
  onRemove,
  onReset,
  onOpenSettings,
  onSwitchWorkspace,
  onAutoLayout,
  onSave,
  canAddSibling,
  canRemove,
}: Props) {
  return (
    <header className="mindmap-header">
      <div className="mindmap-header__lead">
        <div className="mindmap-header__mark" aria-hidden>
          <span className="mindmap-header__mark-inner" />
        </div>
        <div className="mindmap-header__titles">
          <span className="mindmap-header__name">MindLane</span>
          <span className="mindmap-header__tagline">思维导图</span>
        </div>
      </div>

      <nav className="mindmap-header__nav" aria-label="导图操作">
        <div className="mindmap-header__cluster">
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--primary"
            onClick={onAddChild}
          >
            <ListTree className="mindmap-header__icon" size={16} strokeWidth={1.5} />
            <span>子主题</span>
          </button>
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--primary"
            onClick={onAddSibling}
            disabled={!canAddSibling}
            title={!canAddSibling ? '根节点不能添加同级' : undefined}
          >
            <Columns2 className="mindmap-header__icon" size={16} strokeWidth={1.5} />
            <span>同级</span>
          </button>
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--danger"
            onClick={onRemove}
            disabled={!canRemove}
          >
            <Trash2 className="mindmap-header__icon" size={16} strokeWidth={1.5} />
            <span>删除</span>
          </button>
        </div>
        <div className="mindmap-header__cluster mindmap-header__cluster--muted">
          {onAutoLayout && (
            <button
              type="button"
              className="mindmap-header__btn mindmap-header__btn--ghost"
              onClick={onAutoLayout}
              title="自动布局"
            >
              <AlignLeft className="mindmap-header__icon" size={16} strokeWidth={1.5} />
              <span>布局</span>
            </button>
          )}
          {onSave && (
            <button
              type="button"
              className="mindmap-header__btn mindmap-header__btn--ghost"
              onClick={onSave}
              title="保存 (Ctrl+S)"
            >
              <Save className="mindmap-header__icon" size={16} strokeWidth={1.5} />
              <span>保存</span>
            </button>
          )}
          {onSwitchWorkspace && (
            <button
              type="button"
              className="mindmap-header__btn mindmap-header__btn--ghost"
              onClick={onSwitchWorkspace}
              title="切换仓库"
            >
              <FolderInput className="mindmap-header__icon" size={16} strokeWidth={1.5} />
              <span>切换仓库</span>
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              className="mindmap-header__btn mindmap-header__btn--ghost"
              onClick={onOpenSettings}
              title="打开设置"
            >
              <Settings className="mindmap-header__icon" size={16} strokeWidth={1.5} />
              <span>设置</span>
            </button>
          )}
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--ghost"
            onClick={onReset}
          >
            <RotateCcw className="mindmap-header__icon" size={16} strokeWidth={1.5} />
            <span>重置</span>
          </button>
        </div>
      </nav>

      <p className="mindmap-header__hint">
        <span className="mindmap-header__hint-dot" aria-hidden />
        中键拖画布 · 左键选择 · 右键菜单 · 双击编辑 · 滚轮缩放 ·{' '}
        <kbd className="mindmap-header__kbd">Mod</kbd>
        <span className="mindmap-header__kbd-plus">+</span>
        <kbd className="mindmap-header__kbd">/</kbd> 帮助
      </p>
    </header>
  )
}
