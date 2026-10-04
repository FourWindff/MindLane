import { useId, useRef, useState } from 'react'
import { Modal } from '@/shared/components/Modal'

interface TextPromptDialogProps {
  /** Small caption at the top of the panel */
  label: string
  title: string
  subtitle?: string
  placeholder?: string
  confirmLabel?: string
  /** Initial value of the input */
  initialValue?: string
  /** Select the initial value on focus (renaming must select all of it) */
  selectInitial?: boolean
  /** Extra submit condition (defaults to non-empty only); receives the trimmed value */
  canSubmit?: (value: string) => boolean
  /** Disables both buttons while busy; Enter stops working as well */
  disabled?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
  backdropClassName?: string
  panelClassName?: string
}

export function TextPromptDialog({
  label,
  title,
  subtitle,
  placeholder,
  confirmLabel = 'Confirm',
  initialValue = '',
  selectInitial,
  canSubmit,
  disabled,
  onConfirm,
  onCancel,
  backdropClassName,
  panelClassName,
}: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const trimmed = value.trim()
  const canConfirm = trimmed.length > 0 && (canSubmit?.(trimmed) ?? true)

  const submit = () => {
    if (canConfirm && !disabled) onConfirm(trimmed)
  }

  return (
    <Modal
      labelledBy={titleId}
      onCancel={onCancel}
      onSubmit={submit}
      initialFocusRef={inputRef}
      selectInitial={selectInitial}
      backdropClassName={backdropClassName}
      panelClassName={panelClassName}
    >
      <div className="workspace-modal__label">{label}</div>
      <h2 id={titleId} className="workspace-modal__title">
        {title}
      </h2>
      {subtitle && <p className="workspace-modal__subtitle">{subtitle}</p>}
      <input
        ref={inputRef}
        className="workspace-modal__input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
      />
      <div className="workspace-modal__actions">
        <button
          type="button"
          className="workspace-home__action"
          onClick={onCancel}
          disabled={disabled}
        >
          Cancel
        </button>
        <button
          type="button"
          className="workspace-home__action workspace-home__action--primary"
          onClick={submit}
          disabled={disabled || !canConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
