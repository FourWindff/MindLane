import { describe, expect, it } from 'vitest'
import { STRUCTURE_TYPES, VISUAL_VARIANTS, COLOR_SCHEMES } from '../presets'
import { SCHEME_PALETTES } from '../colorPalettes'

describe('导图样式模块配置', () => {
  it('结构轴包含 逻辑图 + 思维导图', () => {
    expect(STRUCTURE_TYPES.map((s) => s.id)).toEqual(['logic', 'mindmap'])
  })

  it('视觉轴包含 卡片/线框/极简，且每套配置齐全', () => {
    const ids = Object.values(VISUAL_VARIANTS).map((v) => v.id)
    expect(ids).toEqual(['card', 'outline', 'minimal'])

    for (const v of Object.values(VISUAL_VARIANTS)) {
      expect(v.edge.path, `${v.id} edge.path`).toBeTruthy()
      expect(v.edge.stroke, `${v.id} edge.stroke`).toBeTruthy()
      expect(v.edge.connect, `${v.id} edge.connect`).toBeTruthy()
      expect(v.edge.strokeWidth, `${v.id} edge.strokeWidth`).toBeGreaterThan(0)
      expect(v.spacing.offsetX, `${v.id} spacing.offsetX`).toBeGreaterThan(0)
      expect(v.spacing.gapY, `${v.id} spacing.gapY`).toBeGreaterThan(0)
    }
  })

  it('仅极简式连接节点下边框，卡片式使用树干渐变边', () => {
    expect(VISUAL_VARIANTS.minimal.edge.connect).toBe('bottom')
    expect(VISUAL_VARIANTS.card.edge.stroke).toBe('trunk')
    expect(VISUAL_VARIANTS.outline.edge.connect).toBe('side')
  })
})

describe('配色方案', () => {
  it('包含 默认（灰）与 彩虹，且每套调色板齐全', () => {
    const ids = COLOR_SCHEMES.map((c) => c.id)
    expect(ids).toContain('default')
    expect(ids).toContain('rainbow')

    for (const scheme of COLOR_SCHEMES) {
      const palette = SCHEME_PALETTES[scheme.id]
      expect(palette, `${scheme.id} palette`).toBeTruthy()
      expect(palette.branches.length, `${scheme.id} branches`).toBeGreaterThan(0)
    }
  })

  it('默认配色全分支同灰（单分支），彩虹配色 6 种分支色', () => {
    expect(SCHEME_PALETTES.default.branches).toHaveLength(1)
    expect(SCHEME_PALETTES.rainbow.branches).toHaveLength(6)
  })
})
