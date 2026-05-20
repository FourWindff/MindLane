import fs from 'node:fs/promises'
import YAML from 'yaml'
import { serializeMindmapOutline } from '../utils/yamlMindmap.js'
import type { DocumentMeta, MindmapYamlNode, PdfChunk, PdfPage } from './types.js'

export async function loadPdfPages(pdfPath: string): Promise<PdfPage[]> {
  const data = await fs.readFile(pdfPath)
  const pdfParse = await import('pdf-parse')
  const PDFParseClass = (pdfParse as unknown as {
    PDFParse?: new (options: { data: Buffer }) => {
      getText: () => Promise<{ pages?: Array<{ text?: string; num?: number }> }>
      destroy: () => Promise<void>
    }
  }).PDFParse

  if (!PDFParseClass) {
    throw new Error('Unable to find pdf-parse PDFParse API')
  }

  const parser = new PDFParseClass({ data })
  try {
    const result = await parser.getText()
    const pages = result.pages ?? []
    return pages
      .map((page, index) => ({
        text: String(page.text ?? '').trim(),
        num: Number(page.num ?? index + 1),
      }))
      .filter((page) => page.text.length > 0)
  } finally {
    await parser.destroy()
  }
}

export function chunkPdfPages(
  pages: PdfPage[],
  chunkCharLimit: number,
): PdfChunk[] {
  const normalizedLimit = Math.max(1000, chunkCharLimit)
  const chunks: PdfChunk[] = []

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
      startPage = page.num
      endPage = page.num
      currentTexts.push(text)
      currentChars = text.length
      continue
    }

    if (currentChars + text.length > normalizedLimit) {
      pushChunk()
      startPage = page.num
      endPage = page.num
      currentTexts.push(text)
      currentChars = text.length
      continue
    }

    currentTexts.push(text)
    endPage = page.num
    currentChars += text.length
  }

  pushChunk()
  return chunks
}

export function serializeMindmapYaml(
  document: DocumentMeta,
  mindmap: MindmapYamlNode,
  now: Date,
): string {
  const metadata = YAML.stringify({
    document: {
      title: document.title,
      source_file: document.pdfPath,
      total_pages: document.totalPages,
    },
    generated_at: now.toISOString(),
  }).trimEnd()

  return `${metadata}\nmindmap:\n${serializeMindmapOutline(mindmap, 1)}\n`
}
