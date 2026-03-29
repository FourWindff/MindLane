import { PanelLeft, PanelRight, Minus, X } from 'lucide-react'
import '../styles/window.css'

type Props = {
  canToggleLeftSidebar: boolean
  canToggleRightSidebar: boolean
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
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
            <PanelLeft size={16} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className={`window-bar__tool${rightSidebarOpen ? ' window-bar__tool--active' : ''}`}
            onClick={onToggleRightSidebar}
            disabled={!canToggleRightSidebar}
            title={rightSidebarOpen ? '收起右侧栏' : '展开右侧栏'}
            aria-label={rightSidebarOpen ? '收起右侧栏' : '展开右侧栏'}
          >
            <PanelRight size={16} strokeWidth={1.5} />
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
          <Minus size={16} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className="window-bar__control window-bar__control--danger"
          onClick={() => void window.mindlane?.window.close()}
          title="关闭"
          aria-label="关闭"
        >
          <X size={16} strokeWidth={1.7} />
        </button>
      </div>
    </header>
  )
}
