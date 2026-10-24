import { describe, expect, it } from 'vitest'
import { MindmapDocumentService } from './documentService.js'
import { readMindmapSection } from './readMindmap.js'
import { createInitialDocument } from '../../../contracts/mindmapDocument/initial.js'

const FILE = 'file-1'

/** A service holding one open document with a root and one child labelled "Guide". */
function openDocument(): MindmapDocumentService {
  const service = new MindmapDocumentService()
  service.handle({
    type: 'open',
    fileUuid: FILE,
    document: createInitialDocument(),
    structureType: 'logic',
  })
  service.handle({
    type: 'apply',
    fileUuid: FILE,
    commands: [
      {
        type: 'addNode',
        node: { id: 'child', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Guide' } },
        edge: { id: 'e-root-child', source: 'root', target: 'child', type: 'mindmap' },
      },
    ],
  })
  return service
}

describe('readMindmapSection', () => {
  it('reads the live document straight from the service (no renderer round trip)', () => {
    const service = openDocument()

    const xml = readMindmapSection(service, FILE)

    expect(xml).toContain('<node id="root"')
    expect(xml).toContain('<node id="child"')
    expect(xml).toContain('Guide')
  })

  it('applies the tree query to the document nodes', () => {
    const service = openDocument()

    expect(
      readMindmapSection(service, FILE, { scope: 'subtree', subtreeId: 'child' }),
    ).not.toContain('id="root"')
    expect(readMindmapSection(service, FILE, { textContains: 'Guide' })).not.toContain('id="root"')
    expect(readMindmapSection(service, FILE, { type: 'image' })).toBe('')
    expect(readMindmapSection(service, FILE, { maxDepth: 0 })).not.toContain('id="child"')
  })

  it('fails with a clear error when the document is not open', () => {
    const service = new MindmapDocumentService()

    expect(() => readMindmapSection(service, 'missing')).toThrow(
      'This file is not open, cannot read the mindmap',
    )
  })
})
