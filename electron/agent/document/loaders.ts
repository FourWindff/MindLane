import { Document } from '@langchain/core/documents'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'

/** Input source of the document ingestion pipeline (PDF file / URL / pasted text) */
export type DocumentSource = {
  type: 'pdf' | 'url' | 'text'
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

export function createDefaultLoaders(): DocumentLoaderRegistry {
  return {
    pdf: loadPdf,
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
