import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { Document } from '@langchain/core/documents'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage } from '@langchain/core/messages'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../../shared/logger.js'

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return ''
}

async function loadMindLaneFile(filePath: string): Promise<Document[]> {
  const startTime = Date.now()
  logger.debug(`加载 MindLane 文件: ${path.basename(filePath)}`)

  const raw = await fs.promises.readFile(filePath, 'utf-8')
  const data = JSON.parse(raw) as {
    metadata?: { title?: string }
    mindmap?: { nodes?: Array<{ data?: { label?: string }; type?: string }> }
  }

  const title = data.metadata?.title ?? path.basename(filePath)
  const nodes = data.mindmap?.nodes ?? []
  const textParts = nodes
    .map((n) => n.data?.label ?? '')
    .filter((l) => l.length > 0)

  logger.debug(`MindLane 文件加载完成: ${path.basename(filePath)}，节点数: ${nodes.length}，文本片段: ${textParts.length}，耗时 ${Date.now() - startTime}ms`)

  return [
    new Document({
      pageContent: `# ${title}\n\n${textParts.join('\n')}`,
      metadata: { source: filePath, filename: path.basename(filePath), type: 'mindlane', title },
    }),
  ]
}

async function loadImageViaVision(
  filePath: string,
  visionModel: BaseChatModel,
): Promise<Document[]> {
  const startTime = Date.now()
  logger.debug(`使用视觉模型解析图片: ${path.basename(filePath)}`)

  const buffer = await fs.promises.readFile(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  const mime = mimeMap[ext] ?? 'image/png'
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`

  try {
    const response = await visionModel.invoke([
      new HumanMessage({
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          {
            type: 'text',
            text: '请仔细阅读这张图片中的所有文字内容，包括标题、正文、标注等。将所有识别到的文字完整输出，保持原有结构。如果图片中没有文字，请描述图片的主要内容。',
          },
        ],
      }),
    ])

    const text = contentToString(response.content).trim()
    logger.debug(`图片解析完成: ${path.basename(filePath)}，识别内容长度: ${text.length}，耗时 ${Date.now() - startTime}ms`)

    return [
      new Document({
        pageContent: text || '(图片内容无法识别)',
        metadata: { source: filePath, filename: path.basename(filePath), type: 'image' },
      }),
    ]
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`图片解析失败: ${path.basename(filePath)}: ${errorMsg}`)
    throw err
  }
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

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

async function loadPdfFile(filePath: string): Promise<Document[]> {
  const startTime = Date.now()
  logger.debug(`加载 PDF 文件: ${path.basename(filePath)}`)

  try {
    const data = await fs.promises.readFile(filePath)
    const result = await parsePDF(data)

    logger.debug(`PDF 加载完成: ${path.basename(filePath)}，页数: ${result.numpages}，内容长度: ${result.text.length}，耗时 ${Date.now() - startTime}ms`)

    return [
      new Document({
        pageContent: result.text.trim() || '(PDF 内容无法提取)',
        metadata: { source: filePath, filename: path.basename(filePath), type: 'pdf', pdf: { totalPages: result.numpages } },
      }),
    ]
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`PDF 加载失败: ${path.basename(filePath)}: ${errorMsg}`)
    throw err
  }
}

export async function loadDocument(
  filePath: string,
  visionModel?: BaseChatModel,
): Promise<Document[]> {
  const startTime = Date.now()
  const ext = path.extname(filePath).toLowerCase()
  const filename = path.basename(filePath)

  logger.debug(`开始加载文档: ${filename} (类型: ${ext || 'text'})`)

  try {
    let result: Document[]

    if (ext === '.pdf') {
      result = await loadPdfFile(filePath)
    } else if (ext === '.docx' || ext === '.doc') {
      const loader = new DocxLoader(filePath)
      result = await loader.load()
      logger.debug(`Word 文档加载完成: ${filename}，内容长度: ${result[0]?.pageContent.length ?? 0}`)
    } else if (ext === '.mindlane') {
      result = await loadMindLaneFile(filePath)
    } else if (IMAGE_EXTS.has(ext)) {
      if (!visionModel) {
        logger.warn(`无法解析图片，未配置视觉模型: ${filename}`)
        result = [
          new Document({
            pageContent: `(图片文件：${filename}，未配置视觉模型无法解析)`,
            metadata: { source: filePath, filename: filename, type: 'image' },
          }),
        ]
      } else {
        result = await loadImageViaVision(filePath, visionModel)
      }
    } else {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      logger.debug(`文本文件加载完成: ${filename}，内容长度: ${content.length}`)
      result = [
        new Document({
          pageContent: content,
          metadata: { source: filePath, filename: filename, type: ext.replace('.', '') || 'text' },
        }),
      ]
    }

    logger.debug(`文档加载完成: ${filename}，耗时 ${Date.now() - startTime}ms`)
    return result
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`文档加载失败: ${filename}: ${errorMsg}`)
    throw err
  }
}
