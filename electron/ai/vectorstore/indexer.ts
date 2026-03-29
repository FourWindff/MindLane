import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import type { Document } from '@langchain/core/documents'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { loadDocument } from './loaders.js'
import { getVectorStore, saveVectorStore } from './store.js'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

export interface IndexedDocMeta {
  id: string
  filename: string
  filePath: string
  indexedAt: string
  chunkCount: number
}

export type IndexProgressCallback = (info: {
  phase: 'loading' | 'splitting' | 'embedding' | 'done' | 'error'
  filename: string
  progress: number // 0-1
  error?: string
}) => void

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 800,
  chunkOverlap: 150,
})

let indexedDocs: IndexedDocMeta[] = []
let metaPath = ''

export function initIndexer(userDataPath: string): void {
  metaPath = path.join(userDataPath, 'vectorstore', 'indexed-docs.json')
  try {
    if (fs.existsSync(metaPath)) {
      indexedDocs = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as IndexedDocMeta[]
    }
  } catch {
    indexedDocs = []
  }
}

function persistMeta(): void {
  if (metaPath) {
    fs.writeFileSync(metaPath, JSON.stringify(indexedDocs, null, 2), 'utf-8')
  }
}

export function listIndexedDocuments(): IndexedDocMeta[] {
  return [...indexedDocs]
}

export async function indexDocument(
  filePath: string,
  visionModel?: BaseChatModel,
  onProgress?: IndexProgressCallback,
): Promise<IndexedDocMeta> {
  const store = getVectorStore()
  if (!store) throw new Error('向量存储未初始化')

  const filename = path.basename(filePath)
  const docId = crypto.randomUUID()

  onProgress?.({ phase: 'loading', filename, progress: 0.1 })
  let docs: Document[]
  try {
    docs = await loadDocument(filePath, visionModel)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onProgress?.({ phase: 'error', filename, progress: 0, error: msg })
    throw err
  }

  onProgress?.({ phase: 'splitting', filename, progress: 0.3 })
  const chunks = await splitter.splitDocuments(docs)

  for (const chunk of chunks) {
    chunk.metadata = {
      ...chunk.metadata,
      docId,
      filename,
      indexedAt: new Date().toISOString(),
    }
  }

  onProgress?.({ phase: 'embedding', filename, progress: 0.5 })
  await store.addDocuments(chunks)

  onProgress?.({ phase: 'embedding', filename, progress: 0.85 })
  await saveVectorStore()

  const meta: IndexedDocMeta = {
    id: docId,
    filename,
    filePath,
    indexedAt: new Date().toISOString(),
    chunkCount: chunks.length,
  }
  indexedDocs.push(meta)
  persistMeta()

  onProgress?.({ phase: 'done', filename, progress: 1 })
  return meta
}

export async function removeIndexedDocument(docId: string): Promise<boolean> {
  const idx = indexedDocs.findIndex((d) => d.id === docId)
  if (idx === -1) return false
  indexedDocs.splice(idx, 1)
  persistMeta()
  return true
}
