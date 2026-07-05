import { describe, expect, it } from 'vitest'
import { findInputAnalyzer, TextInputAnalyzer } from '../textAnalyzer.js'
import { MindmapInputAnalyzer } from '../types.js'

describe('TextInputAnalyzer', () => {
  it('loads text input into a document chunk', async () => {
    const analyzer = new TextInputAnalyzer()
    const document = await analyzer.loadDocument({
      type: 'text',
      content: 'plain text document',
    })

    expect(analyzer.supports({ type: 'text', content: 'plain text document' })).toBe(true)
    expect(analyzer.supports({ type: 'pdf', path: '/tmp/test.pdf' })).toBe(false)
    await expect(analyzer.load('plain text document')).resolves.toBe('plain text document')
    expect(document.text).toBe('plain text document')
    expect(document.chunks).toEqual([
      {
        id: 'chunk-1',
        index: 0,
        startPage: 0,
        endPage: 0,
        text: 'plain text document',
      },
    ])
  })

  it('splits long text input into bounded chunks', async () => {
    const analyzer = new TextInputAnalyzer()
    const text = `${'a'.repeat(3990)}\n\n${'b'.repeat(3990)}\n\n${'c'.repeat(3990)}`

    const document = await analyzer.loadDocument({
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
    const analyzer = new TextInputAnalyzer()
    const text = `${'a'.repeat(4000)}${' '.repeat(4000)}end`

    const document = await analyzer.loadDocument({
      type: 'text',
      content: text,
    })

    expect(document.chunks.length).toBeGreaterThan(1)
    expect(document.chunks.map((chunk) => chunk.text).join('')).toBe(text)
  })

  it('finds an analyzer by source support', () => {
    const textAnalyzer = new TextInputAnalyzer()
    class UnsupportedUrlAnalyzer extends MindmapInputAnalyzer<unknown, unknown> {
      readonly type = 'url' as const

      supports(): boolean {
        return false
      }

      protected resolveInput(): unknown {
        return null
      }

      async load(): Promise<unknown> {
        return ''
      }

      protected getText(): string {
        return ''
      }

      protected chunk(): [] {
        return []
      }
    }
    const analyzers: MindmapInputAnalyzer<unknown, unknown>[] = [
      new UnsupportedUrlAnalyzer(),
      textAnalyzer,
    ]

    expect(findInputAnalyzer(analyzers, { type: 'text', content: 'hello' })).toBe(textAnalyzer)
    expect(findInputAnalyzer(analyzers, { type: 'url', url: 'https://example.test' })).toBeNull()
  })
})
