import { describe, expect, it, vi } from 'vitest'
import { createSearchLinkedDocumentTool } from '../linkedDocumentSearch.js'
import type { CacheManager } from '../../../fs/cacheManager.js'
import type { DocumentRef } from '../../../../src/shared/lib/fileFormat.js'

function createMockCache(textById: Record<string, string | null>): CacheManager {
  return {
    readDocumentText: vi.fn((docId: string) => Promise.resolve(textById[docId] ?? null)),
    cacheDocumentText: vi.fn(),
  } as unknown as CacheManager
}

const doc: DocumentRef = {
  id: 'doc-1',
  type: 'pdf',
  source: '/tmp/source.pdf',
  filename: 'source.pdf',
  importedAt: '2026-05-30T00:00:00.000Z',
  metadata: {
    textCacheKey: 'doc-1',
  },
}

describe('searchLinkedDocument', () => {
  it('returns snippets from cached document text', async () => {
    const cacheManager = createMockCache({
      'doc-1': '第一章 基础知识。第二章 监督学习。决策树是监督学习中的常见方法。第三章 无监督学习。',
    })
    const tool = createSearchLinkedDocumentTool({
      documents: [doc],
      cacheManager,
    })

    const result = await tool.invoke({ query: '决策树', limit: 2 })

    expect(result).toMatchObject({
      ok: true,
      matches: [
        {
          docId: 'doc-1',
          filename: 'source.pdf',
        },
      ],
    })
    expect(result.matches[0].snippet).toContain('决策树')
  })

  it('searches documents from a runtime getter', async () => {
    const cacheManager = createMockCache({ 'doc-1': '第三章 运行时文档列表' })
    const getDocuments = vi.fn(() => [doc])
    const tool = createSearchLinkedDocumentTool({
      documents: getDocuments,
      cacheManager,
    })

    const result = await tool.invoke({ query: '第三章' })

    expect(getDocuments).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('returns a clear error when no documents are linked', async () => {
    const tool = createSearchLinkedDocumentTool({
      documents: [],
      cacheManager: createMockCache({}),
    })

    const result = await tool.invoke({ query: '第三章' })

    expect(result).toEqual({
      ok: false,
      error: '当前思维导图没有关联源文档',
    })
  })

  it('returns a clear error when docId is not linked', async () => {
    const tool = createSearchLinkedDocumentTool({
      documents: [doc],
      cacheManager: createMockCache({}),
    })

    const result = await tool.invoke({ query: '第三章', docId: 'missing-doc' })

    expect(result).toEqual({
      ok: false,
      error: '未找到关联文档：missing-doc',
    })
  })

  it('ignores unsafe persisted textCacheKey values', async () => {
    const unsafeDoc: DocumentRef = {
      ...doc,
      metadata: {
        textCacheKey: '../outside-cache',
      },
    }
    const cacheManager = createMockCache({
      'doc-1': '第三章 安全缓存 key',
    })
    const tool = createSearchLinkedDocumentTool({
      documents: [unsafeDoc],
      cacheManager,
    })

    const result = await tool.invoke({ query: '第三章' })

    expect(cacheManager.readDocumentText).toHaveBeenCalledWith('doc-1')
    expect(result.ok).toBe(true)
  })
})
