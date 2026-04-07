import * as fs from 'node:fs'
import type { Chunk } from '../../types.js'
import { HierarchicalChunker } from './hierarchical.js'

interface PDFPage {
  text: string
  num: number
}

async function parsePDF(data: Buffer): Promise<{ text: string; numpages: number }> {
  const pdfParse = await import('pdf-parse')

  const PDFParseClass = (pdfParse as unknown as { PDFParse: new (options: { data: Buffer }) => { getText: () => Promise<{ text: string; total: number; pages: unknown[] }>; destroy: () => Promise<void> } }).PDFParse

  if (PDFParseClass) {
    const parser = new PDFParseClass({ data })
    try {
      const result = await parser.getText()
      return { text: result.text, numpages: result.total ?? result.pages?.length ?? 0 }
    } finally {
      await parser.destroy()
    }
  }

  const parseFn = (pdfParse as unknown as { default?: (data: Buffer) => Promise<{ text: string; numpages: number }> }).default
    || (pdfParse as unknown as (data: Buffer) => Promise<{ text: string; numpages: number }>)

  if (typeof parseFn === 'function') {
    return parseFn(data)
  }

  throw new Error('Unable to find pdf-parse API')
}

/**
 * Load PDF file and convert to hierarchical chunks
 * Uses pdf-parse which works reliably in Electron Node.js environment
 */
export async function loadPDFChunks(
  filePath: string,
  docId: string
): Promise<Chunk[]> {
  const data = await fs.promises.readFile(filePath)

  // Parse PDF and get text
  const result = await parsePDF(data)

  // Create single page for now (pdf-parse doesn't give per-page easily)
  const pages: PDFPage[] = []
  if (result.text.trim()) {
    pages.push({ text: result.text.trim(), num: 1 })
  }

  const chunker = new HierarchicalChunker()
  return chunker.chunkPDF(pages, docId, filePath)
}
