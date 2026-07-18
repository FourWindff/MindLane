import { describe, it, expect, vi } from 'vitest'
import { Document } from '@langchain/core/documents'
import { loadDocument, createDefaultLoaders, type DocumentLoaderRegistry } from '../loaders.js'

function fakeRegistry(): DocumentLoaderRegistry & {
  pdf: ReturnType<typeof vi.fn>
  url: ReturnType<typeof vi.fn>
  text: ReturnType<typeof vi.fn>
} {
  return {
    pdf: vi.fn().mockResolvedValue([new Document({ pageContent: 'pdf text' })]),
    url: vi.fn().mockResolvedValue([new Document({ pageContent: 'url text' })]),
    text: vi.fn().mockResolvedValue([new Document({ pageContent: 'plain text' })]),
  }
}

describe('loadDocument registry routing', () => {
  it('routes pdf input to the pdf loader', async () => {
    const registry = fakeRegistry()
    const source = { type: 'pdf' as const, path: '/tmp/a.pdf' }

    const docs = await loadDocument(source, registry)

    expect(registry.pdf).toHaveBeenCalledWith(source)
    expect(registry.url).not.toHaveBeenCalled()
    expect(docs[0]!.pageContent).toBe('pdf text')
  })

  it('routes url input to the url loader', async () => {
    const registry = fakeRegistry()
    const source = { type: 'url' as const, url: 'https://example.test/a' }

    const docs = await loadDocument(source, registry)

    expect(registry.url).toHaveBeenCalledWith(source)
    expect(registry.pdf).not.toHaveBeenCalled()
    expect(docs[0]!.pageContent).toBe('url text')
  })

  it('routes text input to the text loader', async () => {
    const registry = fakeRegistry()
    const source = { type: 'text' as const, content: 'hello' }

    const docs = await loadDocument(source, registry)

    expect(registry.text).toHaveBeenCalledWith(source)
    expect(docs[0]!.pageContent).toBe('plain text')
  })

  it('throws a clear error when the registry lacks the loader', async () => {
    await expect(loadDocument({ type: 'pdf', path: '/tmp/a.pdf' }, {})).rejects.toThrow(
      '不支持的输入类型: pdf',
    )
  })
})

describe('default text loader', () => {
  it('wraps text into a single Document', async () => {
    const docs = await loadDocument({ type: 'text', content: '直接粘贴的内容' })

    expect(docs).toHaveLength(1)
    expect(docs[0]!.pageContent).toBe('直接粘贴的内容')
  })

  it('throws a clear error for empty text', async () => {
    await expect(loadDocument({ type: 'text', content: '   ' })).rejects.toThrow(
      '文本输入内容为空。',
    )
  })
})

describe('default registry', () => {
  it('covers pdf / url / text input types', () => {
    const registry = createDefaultLoaders()
    expect(Object.keys(registry).sort()).toEqual(['pdf', 'text', 'url'])
  })
})
