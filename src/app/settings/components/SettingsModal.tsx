import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/shared/components/Modal'
import { SettingsPanel } from './SettingsPanel'
import '../settings.css'

type Props = {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // The panel needs its own ref: this focuses the first button, not an input.
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
    <Modal
      labelledBy="settings-modal-title"
      onCancel={onClose}
      panelRef={panelRef}
      // The settings overlay stacks above the chat panel through the second
      // class (settings.css), so both must stay on the backdrop.
      backdropClassName="workspace-modal-backdrop settings-modal-backdrop"
      panelClassName="settings-modal"
    >
      <div className="settings-modal__header">
        <div className="settings-modal__header-brand">
          <h2 id="settings-modal-title" className="settings-modal__title">
            设置
          </h2>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn--sm settings-modal__close"
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      <div className="settings-modal__body">
        <SettingsPanel />
      </div>
    </Modal>
  )
}
