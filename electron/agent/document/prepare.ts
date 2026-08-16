import path from 'node:path'
import type { Document } from '@langchain/core/documents'
import type { DocumentRef } from '@/shared/lib/fileFormat'
import { loadDocument, type DocumentLoaderRegistry, type DocumentSource } from './loaders.js'
import { splitDocuments } from './split.js'
import { batchDocuments } from './batch.js'
import {
  hashText,
  hashFile,
  shortHash,
  saveDocumentTextCache,
  buildTextPreview,
} from '../graphs/mindmapGraph/documentTextCache.js'

export type PrepareDocumentInput = {
  source: DocumentSource
  loaders: DocumentLoaderRegistry
  budgetChars: number
  existingRef?: DocumentRef
  userDataPath?: string
}

export type PreparedDocument = {
  batches: Document[][]
  documentRef: DocumentRef
}

/**
 * Document ingestion pipeline: load → split → batch, plus the DocumentRef
 * assembly (hashing, text cache, per-source filenames) that used to live
 * inline in the graph's load_document node.
 */
export async function prepareDocument(input: PrepareDocumentInput): Promise<PreparedDocument> {
  const { source, loaders, budgetChars, existingRef, userDataPath } = input

  const docs = await loadDocument(source, loaders)
  const chunks = await splitDocuments(docs)
  const batches = batchDocuments(chunks, budgetChars)
  const text = docs.map((doc) => doc.pageContent).join('\n\n')

  let hash: string
  let baseFilename: string
  let persistedSource: string
  let filename: string
  let type: DocumentRef['type']

  switch (source.type) {
    case 'pdf':
    case 'docx':
    case 'pptx':
    case 'xlsx':
    case 'markdown': {
      const filePath = source.path!
      type = source.type
      hash =
        (await hashFile(filePath).catch(() => undefined)) ?? existingRef?.sha256 ?? hashText(text)
      baseFilename = existingRef?.filename || path.basename(filePath)
      persistedSource = filePath
      filename = existingRef?.filename || path.basename(filePath)
      break
    }
    case 'text': {
      type = 'text'
      hash = hashText(text)
      baseFilename = '用户输入'
      persistedSource = buildTextPreview(text)
      filename = `用户输入_${shortHash(hash)}.txt`
      break
    }
    case 'url': {
      type = 'url'
      hash = hashText(text)
      baseFilename = existingRef?.filename || 'URL来源'
      persistedSource = source.url!
      filename = existingRef?.filename || `URL来源_${shortHash(hash)}.txt`
      break
    }
    default: {
      // Exhaustive fallback
      type = source.type as DocumentRef['type']
      hash = hashText(text)
      baseFilename = existingRef?.filename || '未命名'
      persistedSource = String(source.path ?? source.url ?? source.content ?? '')
      filename = existingRef?.filename || `未命名_${shortHash(hash)}.txt`
    }
  }

  let textPath: string | undefined
  if (userDataPath) {
    textPath = await saveDocumentTextCache(userDataPath, baseFilename, hash, text)
  }

  const documentRef: DocumentRef = {
    id: hash,
    type,
    source: persistedSource,
    filename,
    importedAt: existingRef?.importedAt || new Date().toISOString(),
    title: existingRef?.title,
    pageCount: existingRef?.pageCount,
    textPath,
    sha256: hash,
  }

  return { batches, documentRef }
}
