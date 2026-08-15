import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { StylePanel } from '../StylePanel'
import { MindmapInstance } from '@/features/mindmap/model/mindmapInstance'
import { MindmapInstanceContext } from '@/features/mindmap/hooks/useActiveMindmapInstance'
import { SCHEME_PALETTES } from '@/features/mindmap/style/colorPalettes'
import { COLOR_SCHEMES } from '@/features/mindmap/style/presets'

function renderStylePanel(): string {
  const instance = new MindmapInstance('/test/path.mindlane')
  instance.newFile('测试')
  instance.store
    .getState()
    .setStyle({ structureType: 'mindmap', visualVariant: 'card', colorScheme: 'warm' })
  return renderToString(
    <MindmapInstanceContext.Provider value={instance}>
      <StylePanel initialTab="color" />
    </MindmapInstanceContext.Provider>,
  )
}

describe('StylePanel color tab', () => {
  it('renders a color row for each color scheme', () => {
    const html = renderStylePanel()

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
