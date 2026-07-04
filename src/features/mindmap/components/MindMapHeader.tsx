import {
  GitBranch,
  BetweenHorizontalStart,
  Trash2,
  RotateCcw,
  Save,
  FolderInput,
  Settings,
  Locate,
  Palette,
} from 'lucide-react'

type Props = {
  onAddChild: () => void
  onAddSibling: () => void
  onRemove: () => void
  onReset: () => void
  onOpenSettings?: () => void
  onSwitchWorkspace?: () => void
  onSave?: () => void
  onCenterRoot?: () => void
  onToggleStylePanel?: () => void
  canAddChild: boolean
  canAddSibling: boolean
  canRemove: boolean
  stylePanelOpen?: boolean
  /** 样式面板内容，打开时渲染在工具栏下方。 */
  stylePanel?: React.ReactNode
}

function ToolbarButton({
  onClick,
  disabled,
  ariaLabel,
  tooltip,
  icon,
  variant = 'default',
  active,
}: {
  onClick: () => void
  disabled?: boolean
  ariaLabel: string
  tooltip: string
  icon: React.ReactNode
  variant?: 'default' | 'danger'
  active?: boolean
}) {
  return (
    <div className="float-toolbar__btn-wrap">
      <button
        type="button"
        className={[
          'float-toolbar__btn',
          variant === 'danger' ? 'float-toolbar__btn--danger' : '',
          active ? 'float-toolbar__btn--active' : '',
        ].filter(Boolean).join(' ')}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={active}
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
  onCenterRoot,
  onToggleStylePanel,
  canAddChild,
  canAddSibling,
  canRemove,
  stylePanelOpen,
  stylePanel,
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
            {onCenterRoot && (
              <ToolbarButton
                onClick={onCenterRoot}
                ariaLabel="回到中心主题"
                tooltip="回到中心主题 (Ctrl+0)"
                icon={<Locate size={22} strokeWidth={1.5} />}
              />
            )}
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
            {onToggleStylePanel && (
              <ToolbarButton
                onClick={onToggleStylePanel}
                ariaLabel="导图样式"
                tooltip="导图样式"
                active={stylePanelOpen}
                icon={<Palette size={22} strokeWidth={1.5} />}
              />
            )}
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
        {stylePanel}
      </div>
    </header>
  )
}
