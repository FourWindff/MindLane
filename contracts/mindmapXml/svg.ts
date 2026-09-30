import { parseXmlStrict } from './parser.js'

/**
 * Validate a palace SVG without rasterizing it. The same gate is used by the
 * main process and the renderer so malformed model output consistently becomes
 * an artwork-less palace rather than a broken asset.
 */
export function isValidSvgArtwork(svg: string, stationCount: number): boolean {
  if (!svg.trim() || stationCount < 0) return false

  try {
    const document = parseXmlStrict(svg)
    const root = document.documentElement
    if (!root || root.tagName.toLowerCase() !== 'svg') return false
    if (!root.getAttribute('viewBox')?.trim()) return false

    const groups = root.querySelectorAll('g[data-station]')
    return groups.length === stationCount
  } catch {
    return false
  }
}
