import { describe, expect, it } from 'vitest'
import { clampToViewport } from './ContextMenu'

const viewport = { width: 1000, height: 800 }
const menu = { width: 200, height: 400 }

describe('clampToViewport', () => {
  it('returns an in-view position unchanged', () => {
    expect(clampToViewport(100, 100, menu, viewport)).toEqual({ x: 100, y: 100 })
  })

  it('pulls a bottom-right overflow back inside the viewport', () => {
    expect(clampToViewport(950, 750, menu, viewport)).toEqual({ x: 792, y: 392 })
  })

  it('keeps the 8px margin for coordinates above and left of the viewport', () => {
    expect(clampToViewport(-40, -40, menu, viewport)).toEqual({ x: 8, y: 8 })
  })

  it('falls back to the margin when the menu is larger than the viewport', () => {
    const oversized = { width: 1200, height: 900 }
    expect(clampToViewport(500, 500, oversized, viewport)).toEqual({ x: 8, y: 8 })
  })
})
