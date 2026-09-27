import { useEffect, type ReactNode, type RefObject } from 'react'

interface ModalProps {
  /** 标题元素 id，接 `aria-labelledby` */
  labelledBy: string
  /** Escape / 遮罩点击统一走这里 */
  onCancel: () => void
  /** Enter 提交；缺省时 Enter 不拦截（如忙碌期间） */
  onSubmit?: () => void
  /** 挂载后聚焦的元素；缺省不动焦点（确认框保持既有行为） */
  initialFocusRef?: RefObject<HTMLInputElement | null>
  /** 聚焦时全选初值 */
  selectInitial?: boolean
  /** 遮罩 className：工作区首页用容器内定位的那份，其余用铺满视口的默认值 */
  backdropClassName?: string
  panelClassName?: string
  /** 面板 ref；需要查询面板内元素（如自动聚焦）的调用方使用 */
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
