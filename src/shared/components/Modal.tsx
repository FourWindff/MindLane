import { useEffect, type ReactNode, type RefObject } from 'react'

interface ModalProps {
  /** Id of the title element, wired to `aria-labelledby` */
  labelledBy: string
  /** Escape and backdrop clicks both route here */
  onCancel: () => void
  /** Enter submits; without it Enter is not intercepted (e.g. while busy) */
  onSubmit?: () => void
  /** Element to focus after mount; without it focus is left alone (confirm dialogs keep their behavior) */
  initialFocusRef?: RefObject<HTMLInputElement | null>
  /** Select the initial value on focus */
  selectInitial?: boolean
  /** Backdrop className: the workspace home uses the container-positioned one, the rest use the viewport-filling default */
  backdropClassName?: string
  panelClassName?: string
  /** Panel ref; for callers that need to query elements inside the panel (e.g. autofocus) */
  panelRef?: RefObject<HTMLDivElement>
  children: ReactNode
}

export function Modal({
  labelledBy,
  onCancel,
  onSubmit,
  initialFocusRef,
  selectInitial,
  backdropClassName = 'workspace-modal-backdrop',
  panelClassName = 'workspace-modal',
  panelRef,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!initialFocusRef) return
    const timer = window.setTimeout(() => {
      const input = initialFocusRef.current
      input?.focus()
      if (selectInitial) input?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialFocusRef, selectInitial])

  return (
    <div
      className={backdropClassName}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && onSubmit) {
            event.preventDefault()
            onSubmit()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
