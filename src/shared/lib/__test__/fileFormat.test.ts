import { describe, it, expect } from 'vitest'
import { createEmptyFile, migrateDocumentRef } from '../fileFormat'

describe('MindLaneFile tags', () => {
  it('createEmptyFile should produce file with tags optional', () => {
    const file = createEmptyFile('Test')
    expect(file.metadata.tags).toBeUndefined()
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
