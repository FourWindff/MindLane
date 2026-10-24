import { describe, expect, it } from 'vitest'
import { resolveArtworkStyle } from './palaceArtworkStyle.js'

const IMAGE_GEN = new Set(['chat', 'imageGen'])

describe('resolveArtworkStyle', () => {
  it('uses the image model only when it is both requested and available', () => {
    expect(resolveArtworkStyle('raster', IMAGE_GEN)).toBe('raster')
  })

  it('falls back to drawing when the provider has no image generation', () => {
    expect(resolveArtworkStyle('raster', new Set(['chat']))).toBe('vector')
  })

  it('keeps the requested drawing carrier', () => {
    expect(resolveArtworkStyle('vector', IMAGE_GEN)).toBe('vector')
    expect(resolveArtworkStyle('vector', new Set())).toBe('vector')
  })

  it('uses the default carrier when no preference is stored', () => {
    expect(resolveArtworkStyle(undefined, IMAGE_GEN)).toBe('vector')
  })

  it('never consults the vision capability', () => {
    const visionOnly = new Set(['chat', 'vision'])
    expect(resolveArtworkStyle('raster', visionOnly)).toBe('vector')
    expect(resolveArtworkStyle('vector', visionOnly)).toBe('vector')
  })
})
