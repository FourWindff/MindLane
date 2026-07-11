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

  it('保留已有的 data URL', async () => {
    const state = {
      error: '',
      imageUrls: ['data:image/png;base64,abc123'],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls).toEqual(['data:image/png;base64,abc123'])
  })

  it('将远程 URL 转换为 data URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Buffer.from('fake-image-bytes').buffer,
    })

    const state = {
      error: '',
      imageUrls: ['https://example.com/image.png'],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls[0]).toMatch(/^data:image\/png;base64,/)
  })

  it('转换失败时保留原 URL 作为降级', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'))

    const state = {
      error: '',
      imageUrls: ['https://example.com/image.png'],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls).toEqual(['https://example.com/image.png'])
  })

  it('state 有错误时返回空更新', async () => {
    const state = {
      error: '子图执行失败',
      imageUrls: ['https://example.com/image.png'],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls).toEqual(['https://example.com/image.png'])
  })

  it('空 imageUrls 返回空数组', async () => {
    const state = {
      error: '',
      imageUrls: [],
    }

    const result = await normalizePalaceImageUrls(state)

    expect(result.imageUrls).toEqual([])
  })
})
