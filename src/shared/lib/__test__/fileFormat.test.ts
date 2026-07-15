import { describe, it, expect } from 'vitest'
import { createEmptyFile, migrateDocumentRef } from '../fileFormat'

describe('MindLaneFile tags', () => {
  it('createEmptyFile should produce file with tags optional', () => {
    const file = createEmptyFile('Test')
    expect(file.metadata.tags).toBeUndefined()
  })

  it('assigns a stable UUID to each new file', () => {
    const first = createEmptyFile('First')
    const second = createEmptyFile('Second')

    expect(first.metadata.fileUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(second.metadata.fileUuid).not.toBe(first.metadata.fileUuid)
  })
})

describe('migrateDocumentRef', () => {
  it('should lift sha256 from metadata to top level', () => {
    const migrated = migrateDocumentRef({
      id: 'doc-1',
      type: 'pdf',
      source: '/tmp/test.pdf',
      filename: 'test.pdf',
      importedAt: '2026-05-30T00:00:00.000Z',
      metadata: { sha256: 'legacy-hash' },
    })

    expect(migrated.sha256).toBe('legacy-hash')
    expect(migrated).not.toHaveProperty('metadata')
  })

  it('should keep top-level sha256 when present', () => {
    const migrated = migrateDocumentRef({
      id: 'doc-1',
      type: 'pdf',
      source: '/tmp/test.pdf',
      filename: 'test.pdf',
      importedAt: '2026-05-30T00:00:00.000Z',
      sha256: 'top-hash',
      metadata: { sha256: 'legacy-hash' },
    })

    expect(migrated.sha256).toBe('top-hash')
  })
})
