import { describe, it, expect } from 'vitest'
import { assetFromDataUrl, assetToDataUrl, parseDataUrl } from '../asset'

describe('asset helpers', () => {
  it('parses data URLs into mime + base64', () => {
    const parsed = parseDataUrl('data:image/png;base64,iVBORw0KGgo=')
    expect(parsed).toEqual({ mime: 'image/png', data: 'iVBORw0KGgo=' })
  })

  it('rejects non-data URLs', () => {
    expect(parseDataUrl('https://example.com/a.png')).toBeNull()
  })

  it('builds assets with deterministic sha256 (dedup key)', async () => {
    const a = await assetFromDataUrl('data:image/png;base64,QUJD')
    const b = await assetFromDataUrl('data:image/png;base64,QUJD')
    expect(a!.sha256).toBe(b!.sha256)
    expect(a!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(a!.mime).toBe('image/png')
    expect(a!.data).toBe('QUJD')
  })

  it('roundtrips asset back to data URL', () => {
    expect(assetToDataUrl({ mime: 'image/png', data: 'QUJD' })).toBe('data:image/png;base64,QUJD')
  })

  it('dedups through the store: same content reuses the same asset id', async () => {
    const { createMindmapStore } = await import('@/features/mindmap/model/mindmapStore')
    const store = createMindmapStore()
    const a = await assetFromDataUrl('data:image/png;base64,REVGRQ==')
    const b = await assetFromDataUrl('data:image/png;base64,REVGRQ==')
    const id1 = store.getState().addAsset(a!)
    const id2 = store.getState().addAsset(b!)
    expect(id1).toBe(id2)
    expect(store.getState().assets).toHaveLength(1)
  })
})
