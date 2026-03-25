import '../styles/window.css'

type Props = {
  canToggleLeftSidebar: boolean
  canToggleRightSidebar: boolean
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
}

function IconLeftSidebar() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path
        d="M3.5 4.5h13a1 1 0 011 1v9a1 1 0 01-1 1h-13a1 1 0 01-1-1v-9a1 1 0 011-1zM7 4.5v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconRightSidebar() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path
        d="M3.5 4.5h13a1 1 0 011 1v9a1 1 0 01-1 1h-13a1 1 0 01-1-1v-9a1 1 0 011-1zM13 4.5v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconMinimize() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path
        d="M5 10.5h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconClose() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path
        d="M6 6l8 8M14 6l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function AppWindowBar({
  canToggleLeftSidebar,
  canToggleRightSidebar,
  leftSidebarOpen,
  rightSidebarOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: Props) {
  return (
    <header className="window-bar">
      <div className="window-bar__lead">
        <div className="window-bar__brand">
          <span className="window-bar__brand-mark" aria-hidden />
          <span className="window-bar__brand-name">MindLane</span>
        </div>
        <div className="window-bar__sidebar-actions">
          <button
            type="button"
            className={`window-bar__tool${leftSidebarOpen ? ' window-bar__tool--active' : ''}`}
            onClick={onToggleLeftSidebar}
            disabled={!canToggleLeftSidebar}
            title={leftSidebarOpen ? '收起左侧栏' : '展开左侧栏'}
            aria-label={leftSidebarOpen ? '收起左侧栏' : '展开左侧栏'}
          >
            <IconLeftSidebar />
          </button>
          <button
            type="button"
            className={`window-bar__tool${rightSidebarOpen ? ' window-bar__tool--active' : ''}`}
            onClick={onToggleRightSidebar}
            disabled={!canToggleRightSidebar}
            title={rightSidebarOpen ? '收起右侧栏' : '展开右侧栏'}
            aria-label={rightSidebarOpen ? '收起右侧栏' : '展开右侧栏'}
          >
            <IconRightSidebar />
          </button>
        </div>
      </div>

      <div className="window-bar__window-actions">
        <button
          type="button"
          className="window-bar__control"
          onClick={() => void window.mindlane?.window.minimize()}
          title="最小化"
          aria-label="最小化"
        >
          <IconMinimize />
        </button>
        <button
          type="button"
          className="window-bar__control window-bar__control--danger"
          onClick={() => void window.mindlane?.window.close()}
          title="关闭"
          aria-label="关闭"
        >
          <IconClose />
        </button>
      </div>
    </header>
  )
}
