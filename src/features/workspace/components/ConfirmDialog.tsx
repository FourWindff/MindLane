import { useId } from 'react'
import { Modal } from '@/shared/components/Modal'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()

  return (
    <Modal labelledBy={titleId} onCancel={onCancel} onSubmit={onConfirm}>
      <div className="workspace-modal__label">Confirm action</div>
      <h2 id={titleId} className="workspace-modal__title">
        {title}
      </h2>
      <p className="workspace-modal__subtitle">{message}</p>
      <div className="workspace-modal__actions">
        <button type="button" className="workspace-home__action" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`workspace-home__action ${danger ? 'workspace-home__action--danger' : 'workspace-home__action--primary'}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
