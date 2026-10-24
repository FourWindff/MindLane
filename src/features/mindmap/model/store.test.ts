import { describe, it, expect, beforeEach } from 'vitest'
import { createMindmapStore } from './store'
import { createEmptyFile } from '@contracts/fileFormat'
import { assetFromDataUrl } from '@contracts/mindmapXml/asset'
import type { MindmapDocumentState } from '@contracts/mindmapDocument/state'
import { getDocumentLoopbackService } from './documentLoopback.testutil'

describe('store.viewport', () => {
  let store: ReturnType<typeof createMindmapStore>

  beforeEach(() => {
    store = createMindmapStore()
    store.getState().loadFile('/test/empty.mindlane', createEmptyFile('Test'), null)
  })

  it('should restore viewport from loaded file', () => {
    const file = createEmptyFile('Test file')
    file.mindmap.viewport = { x: 100, y: 200, zoom: 0.8 }

    store.getState().loadFile('/test/path.mindlane', file, null)

    expect(store.getState().viewport).toEqual({ x: 100, y: 200, zoom: 0.8 })
  })

  it('should persist current viewport in toMindLaneFile', () => {
    store.getState().setViewport({ x: 50, y: 75, zoom: 1.2 })

    const file = store.getState().toMindLaneFile()

    expect(file.mindmap.viewport).toEqual({ x: 50, y: 75, zoom: 1.2 })
  })
})

describe('store.style', () => {
  let store: ReturnType<typeof createMindmapStore>

  beforeEach(() => {
    store = createMindmapStore()
    store.getState().loadFile('/test/empty.mindlane', createEmptyFile('Test'), null)
  })

  it('should restore per-file style from loaded file', () => {
    const file = createEmptyFile('Test file')
    file.mindmap.style = {
      structureType: 'mindmap',
      visualVariant: 'minimal',
      colorScheme: 'ocean',
    }

    store.getState().loadFile('/test/path.mindlane', file, null)

    expect(store.getState().style).toEqual({
      structureType: 'mindmap',
      visualVariant: 'minimal',
      colorScheme: 'ocean',
    })
  })

  it('should fall back to default style for files without a style field', () => {
    const file = createEmptyFile('Legacy file')

    store.getState().loadFile('/test/legacy.mindlane', file, null)

    expect(store.getState().style).toEqual({
      structureType: 'logic',
      visualVariant: 'card',
      colorScheme: 'default',
    })
  })

  it('should mark document dirty and persist style in toMindLaneFile', () => {
    store.getState().setStyle({ colorScheme: 'warm' })

    expect(store.getState().dirty).toBe(true)
    expect(store.getState().toMindLaneFile().mindmap.style).toEqual({
      structureType: 'logic',
      visualVariant: 'card',
      colorScheme: 'warm',
    })
  })

  it('should not mark document dirty when style is unchanged', () => {
    store
      .getState()
      .setStyle({ structureType: 'logic', visualVariant: 'card', colorScheme: 'default' })

    expect(store.getState().dirty).toBe(false)
  })
})

describe('store.workspacePath', () => {
  it('records workspacePath on loadFile', () => {
    const store = createMindmapStore()
    const file = createEmptyFile('WS')

    expect(store.getState().workspacePath).toBeNull()

    store.getState().loadFile('/ws/a.mindlane', file, '/ws')
    expect(store.getState().workspacePath).toBe('/ws')
  })
})

describe('store.fileUuid', () => {
  it('preserves the loaded file UUID when serializing changes', () => {
    const store = createMindmapStore()
    const file = createEmptyFile('Identity')

    store.getState().loadFile('/test/identity.mindlane', file, null)

    expect(store.getState().toMindLaneFile().metadata.fileUuid).toBe(file.metadata.fileUuid)
  })
})

describe('store.documentRefs', () => {
  let store: ReturnType<typeof createMindmapStore>

  beforeEach(() => {
    store = createMindmapStore()
    store.getState().loadFile('/test/empty.mindlane', createEmptyFile('Test'), null)
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

describe('store.assets', () => {
  it('dedups by content: the same bytes reuse the same asset id', async () => {
    const store = createMindmapStore()
    const a = await assetFromDataUrl('data:image/png;base64,REVGRQ==')
    const b = await assetFromDataUrl('data:image/png;base64,REVGRQ==')

    const id1 = store.getState().addAsset(a!)
    const id2 = store.getState().addAsset(b!)

    expect(id1).toBe(id2)
    expect(store.getState().assets).toHaveLength(1)
  })
})

describe('store.assets (document projection)', () => {
  it('registers a locally added asset with the document, so AI writes can reference it', async () => {
    const store = createMindmapStore()
    const file = createEmptyFile('Assets')
    store.getState().loadFile('/test/assets.mindlane', file, null)
    const asset = (await assetFromDataUrl('data:image/png;base64,QUJDRA=='))!

    const assetId = store.getState().addAsset(asset)

    // The document owns the file's asset section; the renderer keeps the projection.
    const documentAssets = getDocumentLoopbackService().getAssets(file.metadata.fileUuid)
    expect(documentAssets.map((entry) => entry.id)).toEqual([assetId])
    expect(store.getState().assets.map((entry) => entry.id)).toEqual([assetId])
  })

  it('merges assets pushed with the state and never duplicates them', () => {
    const store = createMindmapStore()
    const file = createEmptyFile('Assets push')
    store.getState().loadFile('/test/assets-push.mindlane', file, null)
    const current = store.getState()
    const pushed = { id: 'pushed', mime: 'image/png', sha256: 'sha-pushed', data: 'REVGRQ==' }

    const withAsset: MindmapDocumentState = {
      fileUuid: current.fileUuid,
      version: current.documentVersion + 1,
      nodes: current.documentNodes,
      edges: current.documentEdges,
      structureType: 'logic',
      canUndo: false,
      canRedo: false,
      dirty: true,
      addedAssets: [pushed],
    }
    expect(store.getState().applyDocumentState(withAsset)).toBe(true)
    expect(store.getState().assets).toEqual([pushed])

    const again: MindmapDocumentState = { ...withAsset, version: withAsset.version + 1 }
    expect(store.getState().applyDocumentState(again)).toBe(true)
    expect(store.getState().assets).toEqual([pushed])
  })
})

describe('store.viewState (landed palace)', () => {
  it('retires the run flags, opens a landed palace and clears the selection marker', () => {
    const store = createMindmapStore()
    const file = createEmptyFile('Palace')
    store.getState().loadFile('/test/palace.mindlane', file, null)
    const current = store.getState()
    // The manual run: a placeholder with progress, its source nodes busy.
    store.getState().setNodeFlag('palace-1', 'generating', true)
    store.getState().setNodeFlag('palace-1', 'runStage', 'planning-stations')
    store.getState().setNodeFlag('source-1', 'processing', true)

    const landed: MindmapDocumentState = {
      fileUuid: current.fileUuid,
      version: current.documentVersion + 1,
      nodes: [
        ...current.documentNodes,
        {
          id: 'palace-1',
          type: 'palace',
          position: { x: 0, y: 0 },
          data: {
            label: 'Landed',
            stations: [{ order: 1, content: 'Station' }],
            sourceNodeIds: ['source-1'],
          },
        },
      ],
      edges: [],
      structureType: 'logic',
      canUndo: true,
      canRedo: false,
      dirty: true,
    }
    expect(store.getState().applyDocumentState(landed)).toBe(true)

    const palace = store.getState().nodes.find((node) => node.id === 'palace-1') as unknown as {
      data: Record<string, unknown>
    }
    // The landing runs in the main process, so the view reconciles the run flags.
    expect(palace.data.generating).toBeUndefined()
    expect(palace.data.runStage).toBeUndefined()
    expect(palace.data.expanded).toBe(true)
  })
})
