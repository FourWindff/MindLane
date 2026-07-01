import { describe, it, expect } from 'vitest'
import { PdfInputAnalyzer, chunkPages } from '../pdfAnalyzer.js'

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

describe('chunkPages', () => {
  it('splits pages into chunks respecting char limit', () => {
    const pages = [
      { text: 'a'.repeat(500), index: 1 },
      { text: 'b'.repeat(500), index: 2 },
      { text: 'c'.repeat(500), index: 3 },
    ]
    const chunks = chunkPages(pages, 800)
    expect(chunks.length).toBe(2)
    expect(chunks[0]!.startPage).toBe(1)
    expect(chunks[0]!.endPage).toBe(2)
    expect(chunks[1]!.startPage).toBe(3)
    expect(chunks[1]!.endPage).toBe(3)
  })
})
