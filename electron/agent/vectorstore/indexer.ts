import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import type { Document } from '@langchain/core/documents'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { loadDocument } from './loaders.js'
import type { VectorStoreManager } from './store.js'
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

export class DocumentIndexer {
  private indexedDocs: IndexedDocMeta[] = []
  private metaPath = ''

  constructor(private vectorStore: VectorStoreManager) {}

  init(userDataPath: string): void {
    this.metaPath = path.join(userDataPath, 'vectorstore', 'indexed-docs.json')
    try {
      if (fs.existsSync(this.metaPath)) {
        this.indexedDocs = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8')) as IndexedDocMeta[]
      }
    } catch {
      this.indexedDocs = []
    }
  }

  private persistMeta(): void {
    if (this.metaPath) {
      fs.writeFileSync(this.metaPath, JSON.stringify(this.indexedDocs, null, 2), 'utf-8')
    }
  }

  list(): IndexedDocMeta[] {
    return [...this.indexedDocs]
  }

  async index(
    filePath: string,
    visionModel?: BaseChatModel,
    onProgress?: IndexProgressCallback,
  ): Promise<IndexedDocMeta> {
    const store = this.vectorStore.get()
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
    await this.vectorStore.save()

    const meta: IndexedDocMeta = {
      id: docId,
      filename,
      filePath,
      indexedAt: new Date().toISOString(),
      chunkCount: chunks.length,
    }
    this.indexedDocs.push(meta)
    this.persistMeta()

    onProgress?.({ phase: 'done', filename, progress: 1 })
    return meta
  }

  async remove(docId: string): Promise<boolean> {
    const idx = this.indexedDocs.findIndex((d) => d.id === docId)
    if (idx === -1) return false
    this.indexedDocs.splice(idx, 1)
    this.persistMeta()
    return true
  }
}
