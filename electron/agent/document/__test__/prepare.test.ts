import { describe, it, expect, vi } from 'vitest'
import { Document } from '@langchain/core/documents'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prepareDocument } from '../prepare.js'
import { hashText } from '../../graphs/mindmapGraph/documentTextCache.js'

function textSource(content: string) {
  return { type: 'text' as const, content }
}

function textLoader(content: string) {
  return { text: vi.fn().mockResolvedValue([new Document({ pageContent: content })]) }
}

describe('prepareDocument DocumentRef assembly', () => {
  it('builds a text ref keyed on the content hash', async () => {
    const { documentRef } = await prepareDocument({
      source: textSource('人工智能文档'),
      loaders: textLoader('人工智能文档'),
      budgetChars: 1000,
    })

    expect(documentRef).toMatchObject({
      type: 'text',
      id: hashText('人工智能文档'),
      sha256: hashText('人工智能文档'),
      source: '人工智能文档',
      filename: `用户输入_${hashText('人工智能文档').slice(0, 8)}.txt`,
    })
    expect(documentRef.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('builds a url ref with the url as source', async () => {
    const { documentRef } = await prepareDocument({
      source: { type: 'url', url: 'https://example.test/a' },
      loaders: { url: vi.fn().mockResolvedValue([new Document({ pageContent: 'url text' })]) },
      budgetChars: 1000,
    })

    expect(documentRef.type).toBe('url')
    expect(documentRef.source).toBe('https://example.test/a')
    expect(documentRef.filename).toContain('URL来源')
  })

  it('backfills the title from loaded metadata.title when absent', async () => {
    const { documentRef } = await prepareDocument({
      source: { type: 'url', url: 'https://example.test/a' },
      loaders: {
        url: vi
          .fn()
          .mockResolvedValue([
            new Document({ pageContent: 'body', metadata: { title: 'Page Title' } }),
          ]),
      },
      budgetChars: 1000,
    })

    expect(documentRef.title).toBe('Page Title')
  })

  it('falls back to the url as title when the page has no title', async () => {
    const { documentRef } = await prepareDocument({
      source: { type: 'url', url: 'https://example.test/a' },
      loaders: { url: vi.fn().mockResolvedValue([new Document({ pageContent: 'body' })]) },
      budgetChars: 1000,
    })

    expect(documentRef.title).toBe('https://example.test/a')
  })

  it('keeps the existing ref title over a loaded title', async () => {
    const { documentRef } = await prepareDocument({
      source: { type: 'url', url: 'https://example.test/a' },
      loaders: {
        url: vi
          .fn()
          .mockResolvedValue([
            new Document({ pageContent: 'body', metadata: { title: 'Page Title' } }),
          ]),
      },
      budgetChars: 1000,
      existingRef: {
        id: 'old',
        type: 'url',
        source: 'https://example.test/a',
        filename: 'old.txt',
        importedAt: '2026-01-01T00:00:00.000Z',
        title: 'Kept',
        sha256: 'kept-hash',
      },
    })

    expect(documentRef.title).toBe('Kept')
  })

  it('builds a file ref hashed from file bytes with basename filename', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mindlane-prepare-'))
    const filePath = path.join(directory, 'notes.md')
    await writeFile(filePath, '# Notes')

    const { documentRef } = await prepareDocument({
      source: { type: 'markdown', path: filePath },
      loaders: { markdown: vi.fn().mockResolvedValue([new Document({ pageContent: '# Notes' })]) },
      budgetChars: 1000,
    })

    expect(documentRef).toMatchObject({
      type: 'markdown',
      source: filePath,
      filename: 'notes.md',
    })
    expect(documentRef.sha256).toBe(hashText('# Notes'))
  })

  it('persists a text cache when userDataPath is provided', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mindlane-prepare-'))
    const { documentRef } = await prepareDocument({
      source: textSource('cached text'),
      loaders: textLoader('cached text'),
      budgetChars: 1000,
      userDataPath: directory,
    })

    expect(documentRef.textPath).toBeTruthy()
    const cached = await readFile(path.join(directory, documentRef.textPath!), 'utf8')
    expect(cached).toBe('cached text')
  })

  it('preserves existing ref fields and falls back to them when file hashing fails', async () => {
    const existingRef = {
      id: 'old',
      type: 'markdown' as const,
      source: '/tmp/old.md',
      filename: 'kept.md',
      importedAt: '2026-01-01T00:00:00.000Z',
      title: 'Kept Title',
      pageCount: 3,
      sha256: 'kept-hash',
    }

    const { documentRef } = await prepareDocument({
      source: { type: 'markdown', path: '/missing.md' },
      loaders: { markdown: vi.fn().mockResolvedValue([new Document({ pageContent: 'body' })]) },
      budgetChars: 1000,
      existingRef,
    })

    expect(documentRef).toMatchObject({
      filename: 'kept.md',
      title: 'Kept Title',
      pageCount: 3,
      importedAt: '2026-01-01T00:00:00.000Z',
      sha256: 'kept-hash',
    })
  })

  it('batches chunks within the given character budget', async () => {
    const content = 'x'.repeat(3000)
    const { batches } = await prepareDocument({
      source: textSource(content),
      loaders: textLoader(content),
      budgetChars: 1000,
    })

    // splitter chunks 3000 chars into 2000 + 1000; each over-budget chunk gets its own batch
    const sizes = batches.map((batch) =>
      batch.reduce((sum, doc) => sum + doc.pageContent.length, 0),
    )
    expect(sizes).toEqual([2000, 1000])
  })
})
