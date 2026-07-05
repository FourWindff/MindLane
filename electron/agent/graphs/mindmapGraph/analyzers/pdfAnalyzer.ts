import fs from 'node:fs/promises'
import { MindmapInputAnalyzer } from './types.js'
import type { DocumentChunk, MindmapInputSource } from './types.js'

interface DocumentPage {
  text: string
  index: number
}

export class PdfInputAnalyzer extends MindmapInputAnalyzer<string, DocumentPage[]> {
  readonly type = 'pdf' as const

  protected resolveInput(source: MindmapInputSource): string {
    if (!source.path) {
      throw new Error('PDF source requires a path')
    }

    return source.path
  }

  async load(path: string): Promise<DocumentPage[]> {
    const data = await fs.readFile(path)
    const pdfParse = await import('pdf-parse')
    const PDFParseClass = (
      pdfParse as unknown as {
        PDFParse?: new (options: { data: Buffer }) => {
          getText: () => Promise<{ pages?: Array<{ text?: string; num?: number }> }>
          destroy: () => Promise<void>
        }
      }
    ).PDFParse

    if (!PDFParseClass) {
      throw new Error('Unable to find pdf-parse PDFParse API')
    }

    const parser = new PDFParseClass({ data })
    try {
      const result = await parser.getText()
      const pages = result.pages ?? []
      return pages
        .map((page, idx) => ({
          text: String(page.text ?? '').trim(),
          index: Number(page.num ?? idx + 1),
        }))
        .filter((page) => page.text.length > 0)
    } finally {
      await parser.destroy()
    }
  }

  protected getText(raw: DocumentPage[]): string {
    return raw.map((page) => page.text).join('\n\n')
  }

  protected chunk(raw: DocumentPage[]): DocumentChunk[] {
    return this.chunkPages(raw, 4000)
  }

  private chunkPages(pages: DocumentPage[], chunkCharLimit: number): DocumentChunk[] {
    const normalizedLimit = Math.max(1000, chunkCharLimit)
    const chunks: DocumentChunk[] = []

    let currentTexts: string[] = []
    let startPage = 0
    let endPage = 0
    let currentChars = 0

    const pushChunk = () => {
      if (currentTexts.length === 0) return
      chunks.push({
        id: `chunk-${chunks.length + 1}`,
        index: chunks.length,
        startPage,
        endPage,
        text: currentTexts.join('\n\n'),
      })
      currentTexts = []
      startPage = 0
      endPage = 0
      currentChars = 0
    }

    for (const page of pages) {
      const text = page.text.trim()
      if (!text) continue

      if (currentTexts.length === 0) {
        startPage = page.index
        endPage = page.index
        currentTexts.push(text)
        currentChars = text.length
        continue
      }

      if (currentChars + text.length > normalizedLimit) {
        pushChunk()
        startPage = page.index
        endPage = page.index
        currentTexts.push(text)
        currentChars = text.length
        continue
      }

      currentTexts.push(text)
      endPage = page.index
      currentChars += text.length
    }

    pushChunk()
    return chunks
  }
}
