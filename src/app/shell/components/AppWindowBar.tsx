import { Minus, Square, X } from 'lucide-react'
import '../styles/window.css'

export function AppWindowBar() {
  return (
    <header className="window-bar">
      <div className="window-bar__lead">
        <div className="window-bar__brand">
          <span className="window-bar__brand-mark" aria-hidden />
          <span className="window-bar__brand-name">MindLane</span>
        </div>
      </div>

      <div className="window-bar__trail">
        <div className="window-bar__window-actions">
          <button
            type="button"
            className="window-bar__control"
            onClick={() => void window.mindlane?.window.minimize()}
            title="Minimize"
            aria-label="Minimize"
          >
            <Minus size={18} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="window-bar__control"
            onClick={() => void window.mindlane?.window.toggleMaximize()}
            title="Maximize"
            aria-label="Maximize"
          >
            <Square size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="window-bar__control window-bar__control--danger"
            onClick={() => void window.mindlane?.window.close()}
            title="Close"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>
      </div>
    </header>
  )
}
