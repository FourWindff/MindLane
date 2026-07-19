import { Document } from '@langchain/core/documents'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { readFile } from 'node:fs/promises'
import { OfficeConverter, type OfficeChunk } from 'officeparser/slim'

/** Input source of the document ingestion pipeline */
export type DocumentSource = {
  type: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'markdown' | 'url' | 'text'
  path?: string
  url?: string
  content?: string
}

/** Loader: parses one input source into LangChain Documents */
export type DocumentLoader = (source: DocumentSource) => Promise<Document[]>

export type DocumentLoaderRegistry = Partial<Record<DocumentSource['type'], DocumentLoader>>

async function loadPdf(source: DocumentSource): Promise<Document[]> {
  if (!source.path) {
    throw new Error('PDF source requires a path')
  }
  // PDFLoader detects the pdf-parse v2 PDFParse class and reuses it natively;
  // one Document per page, page number kept in metadata.loc.pageNumber.
  return new PDFLoader(source.path).load()
}

async function loadUrl(source: DocumentSource): Promise<Document[]> {
  if (!source.url) {
    throw new Error('URL source requires a url')
  }
  return new CheerioWebBaseLoader(source.url).load()
}

async function loadText(source: DocumentSource): Promise<Document[]> {
  const content = source.content ?? ''
  if (!content.trim()) {
    throw new Error('文本输入内容为空。')
  }
  return [new Document({ pageContent: content })]
}

const officeSplitBy = {
  docx: 'paragraph',
  pptx: 'slide',
  xlsx: 'sheet',
} as const

type OfficeDocumentType = keyof typeof officeSplitBy

function isOfficeDocumentType(type: DocumentSource['type']): type is OfficeDocumentType {
  return type in officeSplitBy
}

function officeChunkMetadata(chunk: OfficeChunk): Record<string, string | number> {
  const metadata: Record<string, string | number> = {}
  if (chunk.metadata.slideNumber !== undefined) {
    metadata.slideNumber = chunk.metadata.slideNumber
  }
  if (chunk.metadata.sheetName !== undefined) {
    metadata.sheetName = chunk.metadata.sheetName
  }
  if (chunk.metadata.closestHeading !== undefined) {
    metadata.closestHeading = chunk.metadata.closestHeading
  }
  return metadata
}

async function loadOffice(source: DocumentSource): Promise<Document[]> {
  if (!isOfficeDocumentType(source.type)) {
    throw new Error(`不支持的 Office 输入类型: ${source.type}`)
  }
  const type = source.type
  if (!source.path) {
    throw new Error(`${type.toUpperCase()} source requires a path`)
  }

  try {
    const file = await readFile(source.path)
    const signature = file.subarray(0, 4)
    const isZip =
      signature[0] === 0x50 &&
      signature[1] === 0x4b &&
      ((signature[2] === 0x03 && signature[3] === 0x04) ||
        (signature[2] === 0x05 && signature[3] === 0x06) ||
        (signature[2] === 0x07 && signature[3] === 0x08))
    if (!isZip) {
      throw new Error('文件不是有效的 OOXML 压缩包')
    }

    const result = await OfficeConverter.convert(file, 'chunks', {
      parseConfig: { fileType: type },
      generatorConfig: {
        chunksConfig: {
          strategy: 'document-structure',
          splitBy: officeSplitBy[type],
        },
      },
    })
    const chunks = Array.isArray(result.value) ? (result.value as OfficeChunk[]) : []
    let documents = chunks
      .filter((chunk) => typeof chunk.text === 'string' && chunk.text.trim())
      .map(
        (chunk) =>
          new Document({
            pageContent: chunk.text,
            metadata: officeChunkMetadata(chunk),
          }),
      )

    // Some valid OOXML files do not expose paragraph/slide boundaries to the
    // chunk generator. Fall back to the parser's plain-text representation so
    // readable content is not discarded merely because chunking returned no
    // structural chunks.
    if (documents.length === 0) {
      const textResult = await OfficeConverter.convert(file, 'text', {
        parseConfig: { fileType: type },
      })
      const text = typeof textResult.value === 'string' ? textResult.value.trim() : ''
      if (text) documents = [new Document({ pageContent: text })]
    }

    if (documents.length === 0) {
      throw new Error(`${type.toUpperCase()} 文档未包含可提取的文本内容。`)
    }
    return documents
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === `${type.toUpperCase()} 文档未包含可提取的文本内容。`) {
      throw error
    }
    throw new Error(`无法解析 ${type.toUpperCase()} 文档：${message}`, { cause: error })
  }
}

async function loadMarkdown(source: DocumentSource): Promise<Document[]> {
  if (!source.path) {
    throw new Error('Markdown source requires a path')
  }
  const content = await readFile(source.path, 'utf8')
  if (!content.trim()) {
    throw new Error('Markdown 文档未包含文本内容。')
  }
  return [new Document({ pageContent: content })]
}

export function createDefaultLoaders(): DocumentLoaderRegistry {
  return {
    pdf: loadPdf,
    docx: loadOffice,
    pptx: loadOffice,
    xlsx: loadOffice,
    markdown: loadMarkdown,
    url: loadUrl,
    text: loadText,
  }
}

/** Route to the loader for the source type; unsupported types get a clear error */
export async function loadDocument(
  source: DocumentSource,
  loaders: DocumentLoaderRegistry = createDefaultLoaders(),
): Promise<Document[]> {
  const loader = loaders[source.type]
  if (!loader) {
    throw new Error(`不支持的输入类型: ${source.type}`)
  }
  return loader(source)
}
