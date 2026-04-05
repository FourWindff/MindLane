import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { Document } from '@langchain/core/documents'
import { PDFParse } from 'pdf-parse'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage } from '@langchain/core/messages'
import fs from 'node:fs'
import path from 'node:path'

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

  return [
    new Document({
      pageContent: `# ${title}\n\n${textParts.join('\n')}`,
      metadata: { source: filePath, type: 'mindlane', title },
    }),
  ]
}

async function loadImageViaVision(
  filePath: string,
  visionModel: BaseChatModel,
): Promise<Document[]> {
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
  return [
    new Document({
      pageContent: text || '(图片内容无法识别)',
      metadata: { source: filePath, type: 'image' },
    }),
  ]
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

async function loadPdfFile(filePath: string): Promise<Document[]> {
  const data = await fs.promises.readFile(filePath)
  const parser = new PDFParse({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  })
  try {
    const textResult = await parser.getText()
    const docs: Document[] = []
    for (const page of textResult.pages) {
      const pageContent = page.text.trim()
      if (!pageContent) continue
      docs.push(
        new Document({
          pageContent,
          metadata: {
            source: filePath,
            type: 'pdf',
            loc: { pageNumber: page.num },
            pdf: { totalPages: textResult.total },
          },
        }),
      )
    }
    if (docs.length === 0 && textResult.text.trim()) {
      return [
        new Document({
          pageContent: textResult.text.trim(),
          metadata: { source: filePath, type: 'pdf', pdf: { totalPages: textResult.total } },
        }),
      ]
    }
    return docs
  } finally {
    await parser.destroy()
  }
}

export async function loadDocument(
  filePath: string,
  visionModel?: BaseChatModel,
): Promise<Document[]> {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') {
    return loadPdfFile(filePath)
  }

  if (ext === '.docx' || ext === '.doc') {
    const loader = new DocxLoader(filePath)
    return loader.load()
  }

  if (ext === '.mindlane') {
    return loadMindLaneFile(filePath)
  }

  if (IMAGE_EXTS.has(ext)) {
    if (!visionModel) {
      return [
        new Document({
          pageContent: `(图片文件：${path.basename(filePath)}，未配置视觉模型无法解析)`,
          metadata: { source: filePath, type: 'image' },
        }),
      ]
    }
    return loadImageViaVision(filePath, visionModel)
  }

  // Default: treat as text (md, txt, etc.)
  const content = await fs.promises.readFile(filePath, 'utf-8')
  return [
    new Document({
      pageContent: content,
      metadata: { source: filePath, type: ext.replace('.', '') || 'text' },
    }),
  ]
}
