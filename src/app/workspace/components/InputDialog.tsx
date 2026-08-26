import { useEffect, useRef, useState } from 'react'

interface InputDialogProps {
  label: string
  title: string
  subtitle?: string
  placeholder?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function InputDialog({
  label,
  title,
  subtitle,
  placeholder,
  confirmLabel = '确认',
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed) onConfirm(trimmed)
  }

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
            handleSubmit()
          }
        }}
      >
        <div className="workspace-modal__label">{label}</div>
        <h2 className="workspace-modal__title">{title}</h2>
        {subtitle && <p className="workspace-modal__subtitle">{subtitle}</p>}
        <input
          ref={inputRef}
          className="workspace-modal__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
        />
        <div className="workspace-modal__actions">
          <button type="button" className="workspace-home__action" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="workspace-home__action workspace-home__action--primary"
            onClick={handleSubmit}
            disabled={!value.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
