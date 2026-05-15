import type { ReactNode } from 'react'
import '../styles/side-panel.css'

interface SidePanelProps {
  open: boolean
  children: ReactNode
}

export function SidePanel({ open, children }: SidePanelProps) {
  return (
    <aside className={`side-panel${open ? ' side-panel--open' : ''}`} aria-hidden={!open}>
      {open && <div className="side-panel__body">{children}</div>}
    </aside>
  )
}
