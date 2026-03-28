import { useEffect, useRef, useState } from 'react'

interface RenameDialogProps {
  currentName: string
  isFile: boolean
  onConfirm: (newName: string) => void
  onCancel: () => void
}

export function RenameDialog({ currentName, isFile, onConfirm, onCancel }: RenameDialogProps) {
  const displayName = isFile ? currentName.replace(/\.mindlane$/, '') : currentName
  const [name, setName] = useState(displayName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== displayName) {
      onConfirm(trimmed)
    }
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
        <div className="workspace-modal__label">重命名</div>
        <h2 className="workspace-modal__title">
          {isFile ? '重命名文件' : '重命名文件夹'}
        </h2>
        <input
          ref={inputRef}
          className="workspace-modal__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isFile ? '输入文件名' : '输入文件夹名'}
        />
        <div className="workspace-modal__actions">
          <button type="button" className="workspace-home__action" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="workspace-home__action workspace-home__action--primary"
            onClick={handleSubmit}
            disabled={!name.trim() || name.trim() === displayName}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
