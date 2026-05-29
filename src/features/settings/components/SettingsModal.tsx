import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { SettingsPanel } from './SettingsPanel'
import '@/features/shell/styles/side-panel.css'

type Props = {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector('button, input, select')
      if (target instanceof HTMLElement) {
        target.focus()
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === backdropRef.current) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="settings-modal__header">
          <div className="settings-modal__header-brand">
            <h2 id="settings-modal-title" className="settings-modal__title">
              设置
            </h2>
          </div>
          <button
            type="button"
            className="settings-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="settings-modal__body">
          <SettingsPanel />
        </div>
      </div>
    </div>
  )
}
