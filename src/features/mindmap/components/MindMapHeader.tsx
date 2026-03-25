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

function IconPlusChild() {
  return (
    <svg className="mindmap-header__icon" viewBox="0 0 20 20" aria-hidden>
      <rect
        x="2.5"
        y="4"
        width="9"
        height="11"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M14 8h4M16 6v4"
      />
    </svg>
  )
}

function IconSibling() {
  return (
    <svg className="mindmap-header__icon" viewBox="0 0 20 20" aria-hidden>
      <rect
        x="2"
        y="6"
        width="6"
        height="7"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="12"
        y="6"
        width="6"
        height="7"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M8 9.5h4"
      />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg className="mindmap-header__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 6.5V15a1 1 0 001 1h6a1 1 0 001-1V6.5M8 9v5m4-5v5M4 6.5h12M8 4.5h4a1 1 0 011 1V6H7v-.5a1 1 0 011-1z"
      />
    </svg>
  )
}

function IconReset() {
  return (
    <svg className="mindmap-header__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 9.5A6.5 6.5 0 119 4.2V2.5M9 2.5L6 5.5M9 2.5l3 3"
      />
    </svg>
  )
}

function IconLayout() {
  return (
    <svg className="mindmap-header__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4h14M3 8h10M3 12h7M3 16h4"
      />
    </svg>
  )
}

function IconSave() {
  return (
    <svg className="mindmap-header__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 3h8l4 4v8a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM7 3v5h6V3M7 14h6"
      />
    </svg>
  )
}

function IconWorkspace() {
  return (
    <svg className="mindmap-header__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 5.5h5l1.5 2H17v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 14.5v-9z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M11.5 10H16M14 7.5l2.5 2.5L14 12.5"
      />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg className="mindmap-header__icon" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 3.5l1.2.3.7 1.6 1.7.3 1.2 1.3-.5 1.7 1 1.4-1 1.4.5 1.7-1.2 1.3-1.7.3-.7 1.6-1.2.3-1.2-.3-.7-1.6-1.7-.3-1.2-1.3.5-1.7-1-1.4 1-1.4-.5-1.7 1.2-1.3 1.7-.3.7-1.6L10 3.5z"
      />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
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
            <IconPlusChild />
            <span>子主题</span>
          </button>
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--primary"
            onClick={onAddSibling}
            disabled={!canAddSibling}
            title={!canAddSibling ? '根节点不能添加同级' : undefined}
          >
            <IconSibling />
            <span>同级</span>
          </button>
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--danger"
            onClick={onRemove}
            disabled={!canRemove}
          >
            <IconTrash />
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
              <IconLayout />
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
              <IconSave />
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
              <IconWorkspace />
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
              <IconSettings />
              <span>设置</span>
            </button>
          )}
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--ghost"
            onClick={onReset}
          >
            <IconReset />
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
