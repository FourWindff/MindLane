import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useWorkspaceStore } from '../store'

type Props = {
  label: string
  className: string
  disabled?: boolean
  title?: string
  ariaLabel?: string
  children?: ReactNode
}

export function CreateMindlaneFileButton({
  label,
  className,
  disabled,
  title,
  ariaLabel,
  children,
}: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = useWorkspaceStore((s) => s.busy)
  const createMindlaneFile = useWorkspaceStore((s) => s.createMindlaneFile)

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const close = () => {
    setOpen(false)
    setName('')
  }

  const handleSubmit = async () => {
    const ok = await createMindlaneFile(name.trim())
    if (ok) {
      close()
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        title={title}
        aria-label={ariaLabel}
      >
        {children ?? label}
      </button>
      {open && (
        <div
          className="workspace-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              close()
            }
          }}
        >
          <div
            className="workspace-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mindlane-file-create-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') close()
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSubmit()
              }
            }}
          >
            <div className="workspace-modal__label">新建文件</div>
            <h2 id="mindlane-file-create-title" className="workspace-modal__title">
              输入 `.mindlane` 文件名
            </h2>
            <p className="workspace-modal__subtitle">
              创建后会立即保存到当前工作区，并在左侧文件列表中显示。
            </p>
            <input
              ref={inputRef}
              className="workspace-modal__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：今日总结"
            />
            <div className="workspace-modal__actions">
              <button type="button" className="workspace-home__action" onClick={close} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className="workspace-home__action workspace-home__action--primary"
                onClick={() => void handleSubmit()}
                disabled={busy || name.trim().length === 0}
              >
                创建文件
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
