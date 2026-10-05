import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem = {
  label: string
  onClick: () => void
  disabled: boolean
  modifier?: 'danger' | 'accent' | 'muted'
  title?: string
}

/** The menu's content: plain items, separated by rules. */
export type MenuEntry = MenuItem | 'separator'

type Size = { width: number; height: number }

type ContextMenuProps = {
  /** Viewport coordinates of the pointer that opened the menu. */
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
  /** Root class name; children use its BEM suffixes (`__item` / `__sep` / `__item--<modifier>`). */
  className: string
  ariaLabel: string
}

/** Clamp a desired position so the menu keeps `margin` px away from every viewport edge. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for its unit test; the only cost is a full-page HMR refresh
export function clampToViewport(
  x: number,
  y: number,
  size: Size,
  viewport: Size,
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, margin), Math.max(margin, viewport.width - size.width - margin)),
    y: Math.min(Math.max(y, margin), Math.max(margin, viewport.height - size.height - margin)),
  }
}

/**
 * Shared right-click menu: portal to `body`, viewport-fixed, clamped against the
 * measured menu size, and responsible for closing itself.
 */
export function ContextMenu({ x, y, items, onClose, className, ariaLabel }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // The raw pointer position renders first; measuring before paint keeps the menu
  // inside the viewport without a second render or a visible jump. offsetWidth/Height,
  // not getBoundingClientRect: the open animation scales, and a rect would measure it.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const clamped = clampToViewport(
      x,
      y,
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    menu.style.left = `${clamped.x}px`
    menu.style.top = `${clamped.y}px`
  }, [x, y])

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof window.Node && menuRef.current?.contains(event.target)) return
      onClose()
    }
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', dismiss, true)
    window.addEventListener('keydown', dismissWithEscape)
    return () => {
      window.removeEventListener('mousedown', dismiss, true)
      window.removeEventListener('keydown', dismissWithEscape)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{ left: x, top: y }}
      role="menu"
      aria-label={ariaLabel}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className={`${className}__sep`} role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            className={`${className}__item${item.modifier ? ` ${className}__item--${item.modifier}` : ''}`}
            role="menuitem"
            onClick={() => {
              item.onClick()
              onClose()
            }}
            disabled={item.disabled}
            title={item.title}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
