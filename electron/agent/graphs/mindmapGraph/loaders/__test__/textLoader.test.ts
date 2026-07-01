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

