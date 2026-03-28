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
  confirmLabel = '确认',
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      className="workspace-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="workspace-modal"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter') {
            e.preventDefault()
            onConfirm()
          }
        }}
      >
        <div className="workspace-modal__label">确认操作</div>
        <h2 className="workspace-modal__title">{title}</h2>
        <p className="workspace-modal__subtitle">{message}</p>
        <div className="workspace-modal__actions">
          <button type="button" className="workspace-home__action" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`workspace-home__action ${danger ? 'workspace-home__action--danger' : 'workspace-home__action--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
