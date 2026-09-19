import { describe, expect, it } from 'vitest'
import { extractSvgArtifact, svgToDataUrl } from '../svgArtwork.js'
import { isValidSvgArtwork } from '../../../../src/shared/lib/mindmapXml/svg.js'

const svg = '<svg viewBox="0 0 1000 1000"><g data-station="1"/></svg>'

describe('SVG palace artwork', () => {
  it('extracts coordinates and SVG when the blocks are fenced and reversed', () => {
    const artifact = extractSvgArtifact(`
      \`\`\`svg
      ${svg}
      \`\`\`
      \`\`\`json
      {"stations":[{"order":1,"x":0.12,"y":0.34}]}
      \`\`\`
    `)

    expect(artifact).toEqual({
      stations: [{ order: 1, x: 0.12, y: 0.34 }],
      svg,
    })
  })

  it('encodes the SVG as a base64 data URL', () => {
    expect(svgToDataUrl(svg)).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('accepts only a valid SVG root, viewBox, and station group count', () => {
    expect(isValidSvgArtwork(svg, 1)).toBe(true)
    expect(isValidSvgArtwork('<svg><g data-station="1"/></svg>', 1)).toBe(false)
    expect(isValidSvgArtwork('<div><g data-station="1"/></div>', 1)).toBe(false)
    expect(isValidSvgArtwork('<svg viewBox="0 0 1000 1000"/>', 1)).toBe(false)
  })
})
