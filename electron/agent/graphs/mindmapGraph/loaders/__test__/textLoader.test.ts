import { describe, expect, it } from 'vitest'
import { findDocumentLoader, TextDocumentLoader } from '../textLoader.js'

describe('TextDocumentLoader', () => {
  it('loads text input into a document chunk', async () => {
    const loader = new TextDocumentLoader()
    const document = await loader.loadDocument({
      type: 'text',
      content: 'plain text document',
    })

    expect(loader.supports({ type: 'text', content: 'plain text document' })).toBe(true)
    expect(loader.supports({ type: 'pdf', path: '/tmp/test.pdf' })).toBe(false)
    expect(document.text).toBe('plain text document')
    expect(document.chunks).toEqual([{
      id: 'chunk-1',
      index: 0,
      startPage: 0,
      endPage: 0,
      text: 'plain text document',
    }])
  })

  it('splits long text input into bounded chunks', async () => {
    const loader = new TextDocumentLoader()
    const text = `${'a'.repeat(3990)}\n\n${'b'.repeat(3990)}\n\n${'c'.repeat(3990)}`

    const document = await loader.loadDocument({
      type: 'text',
      content: text,
    })

    expect(document.text).toBe(text)
    expect(document.chunks.length).toBeGreaterThan(1)
    expect(document.chunks.every((chunk) => chunk.text.length <= 4000)).toBe(true)
    expect(document.chunks.map((chunk) => chunk.id)).toEqual(['chunk-1', 'chunk-2', 'chunk-3'])
    expect(document.chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2])
    expect(document.chunks.map((chunk) => chunk.text).join('')).toBe(text)
  })

  it('preserves whitespace-only spans while chunking text input', async () => {
    const loader = new TextDocumentLoader()
    const text = `${'a'.repeat(4000)}${' '.repeat(4000)}end`

    const document = await loader.loadDocument({
      type: 'text',
      content: text,
    })

    expect(document.chunks.length).toBeGreaterThan(1)
    expect(document.chunks.map((chunk) => chunk.text).join('')).toBe(text)
  })

  it('finds a loader by source support', () => {
    const textLoader = new TextDocumentLoader()
    const loaders = [{
      type: 'custom',
      supports: () => false,
      loadDocument: async () => ({ text: '', chunks: [] }),
    }, textLoader]

    expect(findDocumentLoader(loaders, { type: 'text', content: 'hello' })).toBe(textLoader)
    expect(findDocumentLoader(loaders, { type: 'url', url: 'https://example.test' })).toBeNull()
  })
})
