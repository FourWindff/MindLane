import { describe, it, expect, beforeEach } from 'vitest'
import { createMindmapStore } from '../mindmapStore'
import { createEmptyFile, DEFAULT_VIEWPORT } from '@/shared/lib/fileFormat'

describe('mindmapStore.viewport', () => {
  let store: ReturnType<typeof createMindmapStore>

  beforeEach(() => {
    store = createMindmapStore()
    store.getState().newFile('测试')
  })

  it('should restore viewport from loaded file', () => {
    const file = createEmptyFile('测试文件')
    file.mindmap.viewport = { x: 100, y: 200, zoom: 0.8 }

    store.getState().loadFile('/test/path.mindlane', file)

    expect(store.getState().viewport).toEqual({ x: 100, y: 200, zoom: 0.8 })
  })

  it('should persist current viewport in toMindLaneFile', () => {
    store.getState().setViewport({ x: 50, y: 75, zoom: 1.2 })

    const file = store.getState().toMindLaneFile()

    expect(file.mindmap.viewport).toEqual({ x: 50, y: 75, zoom: 1.2 })
  })

  it('should reset viewport on newFile', () => {
    store.getState().setViewport({ x: 999, y: 999, zoom: 2 })

    store.getState().newFile('新文件')

    expect(store.getState().viewport).toEqual(DEFAULT_VIEWPORT)
  })

  it('should reset viewport on clearDocument', () => {
    store.getState().setViewport({ x: 999, y: 999, zoom: 2 })

    store.getState().clearDocument()

    expect(store.getState().viewport).toEqual(DEFAULT_VIEWPORT)
  })
})

describe('mindmapStore.documentRefs', () => {
  let store: ReturnType<typeof createMindmapStore>

  beforeEach(() => {
    store = createMindmapStore()
    store.getState().newFile('测试')
  })

  it('should persist document refs in toMindLaneFile', () => {
    store.getState().addDocumentRef({
      id: 'doc-1',
      type: 'pdf',
      source: '/tmp/source.pdf',
      filename: 'source.pdf',
      importedAt: '2026-05-30T00:00:00.000Z',
      sha256: 'abc123',
    })

    const file = store.getState().toMindLaneFile()

    expect(file.documents).toEqual([
      expect.objectContaining({
        id: 'doc-1',
        filename: 'source.pdf',
        sha256: 'abc123',
      }),
    ])
  })

  it('should migrate legacy document refs with metadata on loadFile', () => {
    const file = createEmptyFile('测试文件')
    file.documents = [
      {
        id: 'legacy-doc',
        type: 'pdf',
        source: '/tmp/legacy.pdf',
        filename: 'legacy.pdf',
        importedAt: '2026-05-30T00:00:00.000Z',
        metadata: { sha256: 'legacy-hash' },
      } as never,
    ]

    store.getState().loadFile('/test/legacy.mindlane', file)

    const loaded = store.getState().documentRefs[0]!
    expect(loaded.sha256).toBe('legacy-hash')
    expect(loaded).not.toHaveProperty('metadata')
  })

  it('should replace document refs with the same id', () => {
    store.getState().addDocumentRef({
      id: 'doc-1',
      type: 'pdf',
      source: '/tmp/old.pdf',
      filename: 'old.pdf',
      importedAt: '2026-05-30T00:00:00.000Z',
      sha256: 'old-hash',
    })
    store.getState().addDocumentRef({
      id: 'doc-1',
      type: 'pdf',
      source: '/tmp/new.pdf',
      filename: 'new.pdf',
      importedAt: '2026-05-30T00:00:01.000Z',
      sha256: 'new-hash',
    })

    expect(store.getState().documentRefs).toHaveLength(1)
    expect(store.getState().documentRefs[0]!.filename).toBe('new.pdf')
  })
})
