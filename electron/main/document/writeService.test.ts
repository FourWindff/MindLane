import { describe, expect, it, vi } from 'vitest'
import { MindmapDocumentService } from './documentService.js'
import { createMindmapWrite } from './writeService.js'
import { createInitialDocument } from '../../../contracts/mindmapDocument/initial.js'
import { planPalacePlaceholder } from '../../../contracts/mindmapDocument/palace.js'
import { serializePalaceNodeXml } from '../../../contracts/mindmapXml/serializer.js'
import type {
  MindmapDocument,
  MindmapDocumentNode,
} from '../../../contracts/mindmapDocument/types.js'
import type { MindLaneAsset } from '../../../contracts/mindmapXml/types.js'

const FILE = 'file-a'

interface Harness {
  documentService: MindmapDocumentService
  write: ReturnType<typeof createMindmapWrite>
  /** The authoritative document value (throws when the file is not open). */
  document: () => MindmapDocument
  node: (label: string) => MindmapDocumentNode | undefined
  insert: (xml: string, args?: Record<string, unknown>) => ReturnType<Harness['write']>
}

function setup(
  options: {
    assets?: MindLaneAsset[]
    document?: MindmapDocument
    warn?: (message: string) => void
  } = {},
): Harness {
  const documentService = new MindmapDocumentService()
  const opened = documentService.handle({
    type: 'open',
    fileUuid: FILE,
    document: options.document ?? createInitialDocument(),
    assets: options.assets ?? [],
    structureType: 'logic',
  })
  if (!opened.ok) throw new Error('open failed')
  const write = createMindmapWrite({ documentService, warn: options.warn })
  const document = (): MindmapDocument => {
    const value = documentService.getDocument(FILE)
    if (!value) throw new Error('document is not open')
    return value
  }
  return {
    documentService,
    write,
    document,
    node: (label) => document().nodes.find((node) => node.data.label === label),
    insert: (xml, args = {}) =>
      write(FILE, 'insertXmlFragment', { xml, targetId: 'root', ...args }),
  }
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

describe('MindmapWrite: local landing', () => {
  it('lands an inserted fragment directly in the authoritative document', async () => {
    const { write, document, node, documentService } = setup()

    const ack = await write(FILE, 'insertXmlFragment', {
      xml: `<node type="text" content="Branch"><node type="text" content="Leaf" /></node>`,
      targetId: 'root',
    })

    expect(ack).toEqual({
      ok: true,
      action: 'insertXmlFragment',
      data: { nodeCount: 2, targetId: 'root', position: 'child' },
    })
    const branch = node('Branch')!
    expect(branch).toBeDefined()
    expect(document().edges).toContainEqual(
      expect.objectContaining({ source: 'root', target: branch.id }),
    )
    expect(documentService.getState(FILE)!.canUndo).toBe(true)
  })

  it('keeps view-only animation markers out of the document', async () => {
    const { insert, node } = setup()

    await insert(`<node type="text" content="Branch" />`)

    const branch = node('Branch')!
    expect(branch.data).not.toHaveProperty('justAdded')
    expect(branch.data).not.toHaveProperty('cascadeDelay')
  })

  it('lands an omitted anchor under the root (the main process has no selection)', async () => {
    const { write, document, node } = setup()

    await write(FILE, 'insertXmlFragment', { xml: `<node type="text" content="Branch" />` })

    const branch = node('Branch')!
    expect(document().edges).toContainEqual(
      expect.objectContaining({ source: 'root', target: branch.id }),
    )
  })

  it('replaces a node with its subtree and keeps its position', async () => {
    const { write, document, node, documentService } = setup()
    await write(FILE, 'insertXmlFragment', {
      xml: `<node type="text" content="A" /><node type="text" content="B" /><node type="text" content="C" />`,
      targetId: 'root',
    })
    const bId = node('B')!.id
    const positionBefore = document().nodes.find((candidate) => candidate.id === bId)!.position

    const ack = await write(FILE, 'updateMindmapNode', {
      xml: `<node id="${bId}" type="text" content="B up"><node type="text" content="B1" /></node>`,
    })

    expect(ack).toMatchObject({ ok: true, action: 'updateMindmapNode' })
    expect(node('B')).toBeUndefined()
    const updated = document().nodes.find((candidate) => candidate.id === bId)!
    expect(updated.data.label).toBe('B up')
    expect(updated.position).toEqual(positionBefore)
    expect(documentService.getState(FILE)!.canUndo).toBe(true)
  })

  it('moves a subtree, and a refused move leaves the document untouched', async () => {
    const { write, document, node, documentService } = setup()
    await write(FILE, 'insertXmlFragment', {
      xml: `<node type="text" content="A"><node type="text" content="A1" /></node>`,
      targetId: 'root',
    })
    const aId = node('A')!.id
    const a1Id = node('A1')!.id
    const versionBefore = documentService.getState(FILE)!.version

    const refused = await write(FILE, 'moveMindmapNode', { nodeId: aId, targetId: a1Id })
    expect(refused.ok).toBe(false)
    expect((refused as { error: string }).error).toContain('[tree_invalid]')
    expect(documentService.getState(FILE)!.version).toBe(versionBefore)

    const moved = await write(FILE, 'moveMindmapNode', { nodeId: a1Id, targetId: 'root' })
    expect(moved).toEqual({
      ok: true,
      action: 'moveMindmapNode',
      data: { nodeId: a1Id, targetId: 'root', position: 'child' },
    })
    expect(document().edges).toContainEqual(
      expect.objectContaining({ source: 'root', target: a1Id }),
    )
  })

  it('deletes a subtree and declines a delete the model did not confirm', async () => {
    const { write, document, node } = setup()
    await write(FILE, 'insertXmlFragment', {
      xml: `<node type="text" content="A"><node type="text" content="A1" /></node>`,
      targetId: 'root',
    })
    const aId = node('A')!.id

    const declined = await write(FILE, 'deleteMindmapNode', {
      nodeId: aId,
      confirmDeleteSubtree: false,
    })
    expect(declined).toEqual({
      ok: true,
      action: 'deleteMindmapNode',
      data: { nodeId: aId, deleted: false },
    })
    expect(node('A')).toBeDefined()

    const deleted = await write(FILE, 'deleteMindmapNode', { nodeId: aId })
    expect(deleted).toEqual({
      ok: true,
      action: 'deleteMindmapNode',
      data: { nodeId: aId, deleted: true },
    })
    expect(document().nodes.some((candidate) => candidate.id === aId)).toBe(false)
    expect(node('A1')).toBeUndefined()
  })

  it('serializes concurrent writes for one file: neither insert is lost', async () => {
    const { write, document } = setup()

    const [first, second] = await Promise.all([
      write(FILE, 'insertXmlFragment', {
        xml: `<node type="text" content="A" />`,
        targetId: 'root',
      }),
      write(FILE, 'insertXmlFragment', {
        xml: `<node type="text" content="B" />`,
        targetId: 'root',
      }),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const labels = document().nodes.map((candidate) => candidate.data.label)
    expect(labels).toContain('A')
    expect(labels).toContain('B')
  })
})

describe('MindmapWrite: landing failure is a tool failure', () => {
  it('returns the XML error code and leaves the document untouched', async () => {
    const { write, documentService } = setup()
    const versionBefore = documentService.getState(FILE)!.version

    const ack = await write(FILE, 'insertXmlFragment', {
      xml: `<node id="root" type="text" content="duplicate" />`,
      targetId: 'root',
    })

    expect(ack.ok).toBe(false)
    expect((ack as { error: string }).error).toContain('[tree_invalid]')
    expect(documentService.getState(FILE)!.version).toBe(versionBefore)
  })

  it('rejects a fragment that references an unknown asset', async () => {
    const { insert } = setup()

    const ack = await insert(`<node type="image" asset="ghost" />`)

    expect(ack.ok).toBe(false)
    expect((ack as { error: string }).error).toContain('[asset_not_found]')
  })

  it('rejects an unknown node with block_not_found instead of a silent success', async () => {
    const { write } = setup()

    const ack = await write(FILE, 'deleteMindmapNode', { nodeId: 'ghost' })

    expect(ack).toEqual({
      ok: false,
      error: '[block_not_found] Node "ghost" does not exist; call readMindmap to locate it again',
    })
  })

  it('reports a file that is not open instead of throwing', async () => {
    const { write } = setup()

    const ack = await write('file-missing', 'insertXmlFragment', {
      xml: `<node type="text" content="x" />`,
    })

    expect(ack).toEqual({ ok: false, error: 'This file is not open, cannot land' })
  })

  it('rejects an invalid position argument instead of coercing it', async () => {
    const { insert } = setup()

    const ack = await insert(`<node type="text" content="x" />`, { position: 'sideways' })

    expect(ack).toEqual({
      ok: false,
      error: 'Invalid position argument: sideways; must be root/child/after/before',
    })
  })
})

describe('MindmapWrite: palace landing', () => {
  const station = (order: number, content: string) => ({
    order,
    content,
    anchorVisual: `anchor-${order}`,
    x: 0.2,
    y: 0.3,
    linkedNodeId: '',
  })

  async function seedSelection(harness: Harness): Promise<{ first: string; second: string }> {
    await harness.insert(
      `<node type="text" content="Chapter"><node type="text" content="First" /><node type="text" content="Second" /></node>`,
    )
    return {
      first: harness.node('First')!.id,
      second: harness.node('Second')!.id,
    }
  }

  it('creates a new palace in the landing slot and rewires the selection under it', async () => {
    const harness = setup()
    const { first, second } = await seedSelection(harness)
    const chapterId = harness.document().edges.find((edge) => edge.target === first)!.source
    const xml = serializePalaceNodeXml({
      label: 'Test palace',
      imageUrl: svgDataUrl('<svg><circle cx="1" cy="1" r="1" /></svg>'),
      stations: [station(1, 'First')],
      sourceNodeIds: [first, second],
    })

    const ack = await harness.write(FILE, 'landPalace', { xml })

    expect(ack).toMatchObject({
      ok: true,
      action: 'landPalace',
      data: { updatedPlaceholder: false, sourceNodeIds: [first, second] },
    })
    const document = harness.document()
    const palace = document.nodes.find((node) => node.type === 'palace')!
    expect(palace).toBeDefined()
    expect(palace.data.label).toBe('Test palace')
    // Artwork became an asset; the node keeps only the reference.
    expect(harness.documentService.getAssets(FILE)).toHaveLength(1)
    expect(palace.data.assetId).toBe(harness.documentService.getAssets(FILE)[0]!.id)
    expect(palace.data).not.toHaveProperty('imageUrl')
    const hasEdge = (source: string, target: string) =>
      document.edges.some((edge) => edge.source === source && edge.target === target)
    expect(hasEdge(chapterId, palace.id)).toBe(true)
    expect(hasEdge(palace.id, first)).toBe(true)
    expect(hasEdge(palace.id, second)).toBe(true)
    expect(hasEdge(chapterId, first)).toBe(false)
  })

  it('updates the manual run placeholder in place and retires its run flags', async () => {
    const harness = setup()
    const { first } = await seedSelection(harness)
    const placeholder = planPalacePlaceholder(harness.document(), [first])
    const placeholderResult = harness.documentService.handle({
      type: 'apply',
      fileUuid: FILE,
      commands: placeholder.commands,
    })
    expect(placeholderResult.ok).toBe(true)
    const xml = serializePalaceNodeXml({
      label: 'Landed palace',
      imageUrl: '',
      stations: [station(1, 'First')],
      sourceNodeIds: [first],
    })

    const ack = await harness.write(FILE, 'landPalace', {
      xml,
      placeholderNodeId: placeholder.nodeId,
    })

    expect(ack).toMatchObject({
      ok: true,
      data: { nodeId: placeholder.nodeId, updatedPlaceholder: true },
    })
    const document = harness.document()
    expect(document.nodes.filter((node) => node.type === 'palace')).toHaveLength(1)
    const palace = document.nodes.find((node) => node.id === placeholder.nodeId)!
    expect(palace.data.label).toBe('Landed palace')
    // Run flags are view state: the document only keeps the landed payload.
    expect(palace.data).not.toHaveProperty('generating')
    expect(palace.data).not.toHaveProperty('expanded')
  })

  it('lands a palace without artwork when the image cannot be read, logging only a warning', async () => {
    const warn = vi.fn()
    const harness = setup({ warn })
    const { first } = await seedSelection(harness)
    const xml = serializePalaceNodeXml({
      label: 'No artwork palace',
      imageUrl: 'https://example.com/palace.png',
      stations: [station(1, 'First')],
      sourceNodeIds: [first],
    })

    const ack = await harness.write(FILE, 'landPalace', { xml })

    expect(ack.ok).toBe(true)
    expect(harness.documentService.getAssets(FILE)).toHaveLength(0)
    const palace = harness.document().nodes.find((node) => node.type === 'palace')!
    expect(palace.data).not.toHaveProperty('assetId')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('reuses an existing asset with the same bytes instead of duplicating it', async () => {
    const harness = setup()
    const svg = '<svg><rect width="10" height="10" /></svg>'
    await harness.insert(
      `<node type="palace" content="First palace" imageUrl="${svgDataUrl(svg)}" />`,
    )
    await harness.insert(
      `<node type="palace" content="Second palace" imageUrl="${svgDataUrl(svg)}" />`,
    )

    const assets = harness.documentService.getAssets(FILE)
    expect(assets).toHaveLength(1)
    const palaces = harness.document().nodes.filter((node) => node.type === 'palace')
    expect(palaces).toHaveLength(2)
    expect(palaces.every((node) => node.data.assetId === assets[0]!.id)).toBe(true)
  })
})
