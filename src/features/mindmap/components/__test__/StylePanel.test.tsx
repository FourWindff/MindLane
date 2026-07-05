import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { StylePanel } from '../StylePanel'
import { useStyleStore } from '@/features/mindmap/style/styleStore'
import { SCHEME_PALETTES } from '@/features/mindmap/style/colorPalettes'
import { COLOR_SCHEMES } from '@/features/mindmap/style/presets'

describe('StylePanel color tab', () => {
  it('renders a color row for each color scheme', () => {
    useStyleStore.setState({ mapStyle: 'mindmap-card', colorScheme: 'warm' })
    const html = renderToString(<StylePanel initialTab="color" />)

    for (const cs of COLOR_SCHEMES) {
      const buttonMatch = html.match(
        new RegExp(`<button[^>]*aria-label="${cs.label}"[^>]*>([\\s\\S]*?)</button>`),
      )
      expect(buttonMatch, `expected button for ${cs.label}`).toBeTruthy()
      const buttonHtml = buttonMatch![1]

      const bars = [...buttonHtml.matchAll(/class="style-panel__swatch-bar"/g)]
      expect(bars.length).toBe(SCHEME_PALETTES[cs.id].branches.length)

      const renderedColors = [
        ...buttonHtml.matchAll(/class="style-panel__swatch-bar" style="background:\s*([^;"]+)"/g),
      ]
      SCHEME_PALETTES[cs.id].branches.forEach((branch, i) => {
        expect(renderedColors[i][1]).toBe(branch.depth1.nodeBg)
      })
    }
  })
})
