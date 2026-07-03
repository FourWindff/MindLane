import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { StylePanel } from '../StylePanel'
import { useStyleStore } from '@/features/mindmap/style/styleStore'
import { SCHEME_PALETTES } from '@/features/mindmap/style/colorPalettes'

describe('StylePanel color tab', () => {
  it('renders 4 color bars for each color scheme', () => {
    useStyleStore.setState({ mapStyle: 'mindmap-card', colorScheme: 'warm' })
    const html = renderToString(<StylePanel initialTab="color" />)

    const labels = ['暖石', '海蓝', '森绿', '暮橙', '暗夜']
    for (const label of labels) {
      const buttonMatch = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</button>`))
      expect(buttonMatch, `expected button for ${label}`).toBeTruthy()
      const buttonHtml = buttonMatch![1]
      const bars = [...buttonHtml.matchAll(/class="style-panel__swatch-bar"/g)]
      expect(bars.length).toBe(4)
    }

    const warm = SCHEME_PALETTES.warm
    const warmButtonMatch = html.match(/<button[^>]*aria-label="暖石"[^>]*>([\s\S]*?)<\/button>/)
    expect(warmButtonMatch).toBeTruthy()
    const warmBars = [...warmButtonMatch![1].matchAll(/class="style-panel__swatch-bar" style="background:\s*([^;"]+)"/g)]
    expect(warmBars.length).toBe(4)
    expect(warmBars[0][1]).toBe(warm.branches[0]!.depth1.nodeBg)
    expect(warmBars[1][1]).toBe(warm.branches[1]!.depth1.nodeBg)
    expect(warmBars[2][1]).toBe(warm.branches[2]!.depth1.nodeBg)
    expect(warmBars[3][1]).toBe(warm.branches[3]!.depth1.nodeBg)
  })
})
