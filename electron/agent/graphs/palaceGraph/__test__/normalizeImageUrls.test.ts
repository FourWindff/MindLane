import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizePalaceImageUrls } from '../normalizeImageUrls.js'

describe('normalizePalaceImageUrls', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('keeps an existing data URL', async () => {
    const state = {
      palaceError: '',
      imageUrls: ['data:image/png;base64,abc123'],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls).toEqual(['data:image/png;base64,abc123'])
  })

  it('converts a remote URL into a data URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Buffer.from('fake-image-bytes').buffer,
    })

    const state = {
      palaceError: '',
      imageUrls: ['https://example.com/image.png'],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls[0]).toMatch(/^data:image\/png;base64,/)
  })

  it('keeps the original URL as a fallback when conversion fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'))

    const state = {
      palaceError: '',
      imageUrls: ['https://example.com/image.png'],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls).toEqual(['https://example.com/image.png'])
  })

  it('returns the original imageUrls when state has an error', async () => {
    const state = {
      palaceError: 'subgraph failed',
      imageUrls: ['https://example.com/image.png'],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls).toEqual(['https://example.com/image.png'])
  })

  it('returns an empty array for empty imageUrls', async () => {
    const state = {
      palaceError: '',
      imageUrls: [],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls).toEqual([])
  })
})
