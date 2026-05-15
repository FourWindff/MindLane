import { FolderOpen, Minus, Square, X } from 'lucide-react'
import '../styles/window.css'

type Props = {
  onOpenFileManager: () => void
  fileManagerOpen: boolean
}

export function AppWindowBar({
  onOpenFileManager,
  fileManagerOpen,
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
            className={`window-bar__tool${fileManagerOpen ? ' window-bar__tool--active' : ''}`}
            onClick={onOpenFileManager}
            title="打开文件管理器"
            aria-label="打开文件管理器"
          >
            <FolderOpen size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="window-bar__trail">
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
            className="window-bar__control"
            onClick={() => void window.mindlane?.window.toggleMaximize()}
            title="最大化"
            aria-label="最大化"
          >
            <Square size={13} strokeWidth={1.7} />
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
      </div>
    </header>
  )
}
