import { describe, expect, it } from 'vitest'
import { STRUCTURE_TYPES, VISUAL_VARIANTS, COLOR_SCHEMES } from './presets'
import { SCHEME_PALETTES } from './colorPalettes'

describe('mindmap style module configuration', () => {
  it('the structure axis has logic + mindmap', () => {
    expect(STRUCTURE_TYPES.map((s) => s.id)).toEqual(['logic', 'mindmap'])
  })

  it('the visual axis has card/outline/minimal, each with a complete config', () => {
    const ids = Object.values(VISUAL_VARIANTS).map((v) => v.id)
    expect(ids).toEqual(['card', 'outline', 'minimal'])

    for (const v of Object.values(VISUAL_VARIANTS)) {
      expect(v.edge.path, `${v.id} edge.path`).toBeTruthy()
      expect(v.edge.stroke, `${v.id} edge.stroke`).toBeTruthy()
      expect(v.edge.connect, `${v.id} edge.connect`).toBeTruthy()
      expect(v.edge.strokeWidth, `${v.id} edge.strokeWidth`).toBeGreaterThan(0)
    }
  })

  it('only minimal connects to the node bottom; card uses a tapered trunk edge', () => {
    expect(VISUAL_VARIANTS.minimal.edge.connect).toBe('bottom')
    expect(VISUAL_VARIANTS.card.edge.stroke).toBe('trunk')
    expect(VISUAL_VARIANTS.outline.edge.connect).toBe('side')
  })
})

describe('color schemes', () => {
  it('includes default (gray) and rainbow, each with a complete palette', () => {
    const ids = COLOR_SCHEMES.map((c) => c.id)
    expect(ids).toContain('default')
    expect(ids).toContain('rainbow')

    for (const scheme of COLOR_SCHEMES) {
      const palette = SCHEME_PALETTES[scheme.id]
      expect(palette, `${scheme.id} palette`).toBeTruthy()
      expect(palette.branches.length, `${scheme.id} branches`).toBeGreaterThan(0)
    }
  })

  it('default is gray on every branch (single branch); rainbow has 6 branch colors', () => {
    expect(SCHEME_PALETTES.default.branches).toHaveLength(1)
    expect(SCHEME_PALETTES.rainbow.branches).toHaveLength(6)
  })
})
