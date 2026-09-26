import { useId, useRef, useState } from 'react'
import { Modal } from './Modal'

interface TextPromptDialogProps {
  /** 面板顶部的小字说明 */
  label: string
  title: string
  subtitle?: string
  placeholder?: string
  confirmLabel?: string
  /** 输入框初值 */
  initialValue?: string
  /** 聚焦时全选初值（重命名要全选） */
  selectInitial?: boolean
  /** 额外提交条件（默认只要求非空）；收到的是 trim 后的值 */
  canSubmit?: (value: string) => boolean
  /** 忙碌时禁用两个按钮，Enter 一并失效 */
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
  confirmLabel = '确认',
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
          取消
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
