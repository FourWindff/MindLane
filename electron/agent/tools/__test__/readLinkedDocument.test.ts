import { describe, it, expect } from 'vitest'
import { createReadLinkedDocumentTool } from '../readLinkedDocument.js'
import { CacheManager } from '../../../fs/cacheManager.js'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import type { DocumentRef } from '../../../../src/shared/lib/fileFormat.js'

async function createTempCacheManager(): Promise<{
  cacheManager: CacheManager
  cleanup: () => Promise<void>
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindlane-read-doc-'))
  const cacheManager = new CacheManager(tmpDir)
  await cacheManager.initialize()
  return {
    cacheManager,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    },
  }
}

function createDocumentRef(overrides: Partial<DocumentRef> = {}): DocumentRef {
  return {
    id: 'doc-1',
    type: 'pdf',
    source: '/data/doc1.pdf',
    filename: 'doc1.pdf',
    importedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('readLinkedDocument tool', () => {
  it('reads full cached text when no range is provided', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      await cacheManager.cacheDocumentText('doc-1', 'line1\nline2\nline3')
      const tool = createReadLinkedDocumentTool({
        cacheManager,
        documents: [createDocumentRef()],
      })

      const result = await tool.invoke({ documentRefId: 'doc-1' })

      expect(result).toMatchObject({
        ok: true,
        documentRefId: 'doc-1',
        text: 'line1\nline2\nline3',
        startLine: 1,
        endLine: 3,
        totalLines: 3,
      })
    } finally {
      await cleanup()
    }
  })

  it('reads a specific line range', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      await cacheManager.cacheDocumentText('doc-1', 'a\nb\nc\nd\ne')
      const tool = createReadLinkedDocumentTool({
        cacheManager,
        documents: [createDocumentRef()],
      })

      const result = await tool.invoke({ documentRefId: 'doc-1', start: 2, end: 4 })

      expect(result).toMatchObject({
        ok: true,
        text: 'b\nc\nd',
        startLine: 2,
        endLine: 4,
        totalLines: 5,
      })
    } finally {
      await cleanup()
    }
  })

  it('clamps out-of-range values', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      await cacheManager.cacheDocumentText('doc-1', 'a\nb\nc')
      const tool = createReadLinkedDocumentTool({
        cacheManager,
        documents: [createDocumentRef()],
      })

      const result = await tool.invoke({
        documentRefId: 'doc-1',
        start: 5,
        end: 100,
      })

      expect(result).toMatchObject({
        ok: true,
        text: 'c',
        startLine: 3,
        endLine: 3,
        totalLines: 3,
      })
    } finally {
      await cleanup()
    }
  })

  it('returns error when document is not found', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      const tool = createReadLinkedDocumentTool({
        cacheManager,
        documents: [createDocumentRef()],
      })

      const result = await tool.invoke({ documentRefId: 'missing-doc' })

      expect(result).toMatchObject({
        ok: false,
        error: '未找到关联文档：missing-doc',
      })
    } finally {
      await cleanup()
    }
  })

  it('returns error when document text is not cached', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      const tool = createReadLinkedDocumentTool({
        cacheManager,
        documents: [createDocumentRef()],
      })

      const result = await tool.invoke({ documentRefId: 'doc-1' })

      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining('文档文本尚未缓存'),
      })
    } finally {
      await cleanup()
    }
  })

  it('uses metadata.textCacheKey when resolving cache', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      await cacheManager.cacheDocumentText('custom-key', 'cached with custom key')
      const doc = createDocumentRef({
        id: 'doc-1',
        metadata: { textCacheKey: 'custom-key' },
      })
      const tool = createReadLinkedDocumentTool({
        cacheManager,
        documents: [doc],
      })

      const result = await tool.invoke({ documentRefId: 'doc-1' })

      expect(result).toMatchObject({
        ok: true,
        text: 'cached with custom key',
      })
    } finally {
      await cleanup()
    }
  })

  it('supports documents provided as a callback', async () => {
    const { cacheManager, cleanup } = await createTempCacheManager()
    try {
      await cacheManager.cacheDocumentText('doc-1', 'callback doc')
      const tool = createReadLinkedDocumentTool({
        cacheManager,
        documents: () => [createDocumentRef()],
      })

      const result = await tool.invoke({ documentRefId: 'doc-1' })

      expect(result).toMatchObject({
        ok: true,
        text: 'callback doc',
      })
    } finally {
      await cleanup()
    }
  })
})
