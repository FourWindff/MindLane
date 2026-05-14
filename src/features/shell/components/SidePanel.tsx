import type { ReactNode } from 'react'
import '../styles/side-panel.css'

export type SidePanelTab = 'chat'

const TABS: { id: SidePanelTab; label: string }[] = [
  { id: 'chat', label: '对话' },
]

interface SidePanelProps {
  open: boolean
  activeTab: SidePanelTab
  onTabChange: (tab: SidePanelTab) => void
  children: Record<SidePanelTab, ReactNode>
}

export function SidePanel({
  open,
  activeTab,
  onTabChange,
  children,
}: SidePanelProps) {
  return (
    <aside className={`side-panel${open ? ' side-panel--open' : ''}`} aria-hidden={!open}>
      {open && (
        <>
          <nav className="side-panel__tabs" aria-label="面板选项卡">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`side-panel__tab${activeTab === tab.id ? ' side-panel__tab--active' : ''}`}
                onClick={() => onTabChange(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="side-panel__body">{children[activeTab]}</div>
        </>
      )}
    </aside>
  )
}
