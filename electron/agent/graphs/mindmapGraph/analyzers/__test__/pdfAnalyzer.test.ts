import { describe, it, expect } from 'vitest'
import { PdfInputAnalyzer } from '../pdfAnalyzer.js'

class TestPdfInputAnalyzer extends PdfInputAnalyzer {
  async load() {
    return [
      { text: 'a'.repeat(1500), index: 1 },
      { text: 'b'.repeat(1500), index: 2 },
      { text: 'c'.repeat(1500), index: 3 },
    ]
  }
}

describe('PdfInputAnalyzer', () => {
  it('supports pdf type', () => {
    const analyzer = new PdfInputAnalyzer()
    expect(analyzer.supports({ type: 'pdf' })).toBe(true)
    expect(analyzer.supports({ type: 'url' })).toBe(false)
  })

  it('throws when path is missing', async () => {
    const analyzer = new PdfInputAnalyzer()
    await expect(analyzer.loadDocument({ type: 'pdf' })).rejects.toThrow('PDF source requires a path')
  })
})

describe('PdfInputAnalyzer chunking', () => {
  it('splits pages into chunks respecting char limit', async () => {
    const analyzer = new TestPdfInputAnalyzer()
    const { chunks } = await analyzer.loadDocument({ type: 'pdf', path: 'unused.pdf' })
    expect(chunks.length).toBe(2)
    expect(chunks[0]!.startPage).toBe(1)
    expect(chunks[0]!.endPage).toBe(2)
    expect(chunks[1]!.startPage).toBe(3)
    expect(chunks[1]!.endPage).toBe(3)
  })
})
