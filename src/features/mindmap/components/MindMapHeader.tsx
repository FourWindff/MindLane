import {
  GitBranch,
  BetweenHorizontalStart,
  Trash2,
  RotateCcw,
  Save,
  FolderInput,
  Settings,
} from 'lucide-react'

type Props = {
  onAddChild: () => void
  onAddSibling: () => void
  onRemove: () => void
  onReset: () => void
  onOpenSettings?: () => void
  onSwitchWorkspace?: () => void
  onSave?: () => void
  canAddChild: boolean
  canAddSibling: boolean
  canRemove: boolean
}

function ToolbarButton({
  onClick,
  disabled,
  ariaLabel,
  tooltip,
  icon,
  variant = 'default',
}: {
  onClick: () => void
  disabled?: boolean
  ariaLabel: string
  tooltip: string
  icon: React.ReactNode
  variant?: 'default' | 'danger'
}) {
  return (
    <div className="float-toolbar__btn-wrap">
      <button
        type="button"
        className={`float-toolbar__btn${variant === 'danger' ? ' float-toolbar__btn--danger' : ''}`}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {icon}
      </button>
      <span className="float-toolbar__tooltip">{tooltip}</span>
    </div>
  )
}

export function MindMapHeader({
  onAddChild,
  onAddSibling,
  onRemove,
  onReset,
  onOpenSettings,
  onSwitchWorkspace,
  onSave,
  canAddChild,
  canAddSibling,
  canRemove,
}: Props) {
  return (
    <header className="mindmap-header">
      <div className="mindmap-header__panel">
        <nav className="float-toolbar" aria-label="导图操作">
          <div className="float-toolbar__group float-toolbar__group--edit">
            <ToolbarButton
              onClick={onAddChild}
              disabled={!canAddChild}
              ariaLabel="添加子主题"
              tooltip="添加子主题"
              icon={<GitBranch size={22} strokeWidth={1.5} />}
            />
            <ToolbarButton
              onClick={onAddSibling}
              disabled={!canAddSibling}
              ariaLabel="添加同级主题"
              tooltip={!canAddSibling ? '根节点不能添加同级' : '添加同级主题'}
              icon={<BetweenHorizontalStart size={22} strokeWidth={1.5} />}
            />
            <ToolbarButton
              onClick={onRemove}
              disabled={!canRemove}
              ariaLabel="删除"
              tooltip="删除"
              variant="danger"
              icon={<Trash2 size={22} strokeWidth={1.5} />}
            />
          </div>

          <div className="float-toolbar__divider" />

          <div className="float-toolbar__group float-toolbar__group--file">
            {onSave && (
              <ToolbarButton
                onClick={onSave}
                ariaLabel="保存"
                tooltip="保存 (Ctrl+S)"
                icon={<Save size={22} strokeWidth={1.5} />}
              />
            )}
            {onSwitchWorkspace && (
              <ToolbarButton
                onClick={onSwitchWorkspace}
                ariaLabel="切换仓库"
                tooltip="切换仓库"
                icon={<FolderInput size={22} strokeWidth={1.5} />}
              />
            )}
          </div>

          <div className="float-toolbar__divider" />

          <div className="float-toolbar__group float-toolbar__group--system">
            {onOpenSettings && (
              <ToolbarButton
                onClick={onOpenSettings}
                ariaLabel="打开设置"
                tooltip="打开设置"
                icon={<Settings size={22} strokeWidth={1.5} />}
              />
            )}
            <ToolbarButton
              onClick={onReset}
              ariaLabel="重置"
              tooltip="重置"
              icon={<RotateCcw size={22} strokeWidth={1.5} />}
            />
          </div>
        </nav>
      </div>
    </header>
  )
}
