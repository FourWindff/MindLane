import type { Document } from '@langchain/core/documents'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { VectorStoreManager } from './storage/vector-store.js'
import type { DocumentStore } from './storage/document-store.js'
import type { BM25SearchEngine } from './retrieval/core/bm25.js'
import { HierarchicalChunker, generateParentSummaries } from './prepare/chunk/index.js'
import type { Chunk } from './types.js'
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
  phase: 'loading' | 'chunking' | 'summarizing' | 'embedding' | 'done' | 'error'
  filename: string
  progress: number
  error?: string
}) => void

/**
 * DocumentIndexer coordinates the full indexing pipeline:
 * load → chunk → summarize → embed → store
 */
export class DocumentIndexer {
  private indexedDocs: IndexedDocMeta[] = []
  private metaPath = ''

  constructor(
    private vectorStore: VectorStoreManager,
    private documentStore: DocumentStore,
    private bm25Engine: BM25SearchEngine,
  ) {}

  init(userDataPath: string): void {
    this.metaPath = path.join(userDataPath, 'vectorstore-v2', 'indexed-docs.json')
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
    loadFn: (filePath: string) => Promise<Document[]>,
    llm?: BaseChatModel,
    onProgress?: IndexProgressCallback,
  ): Promise<IndexedDocMeta> {
    const filename = path.basename(filePath)
    const docId = crypto.randomUUID()

    onProgress?.({ phase: 'loading', filename, progress: 0.1 })

    let docs: Document[]
    try {
      docs = await loadFn(filePath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onProgress?.({ phase: 'error', filename, progress: 0, error: msg })
      throw err
    }

    onProgress?.({ phase: 'chunking', filename, progress: 0.3 })

    const chunker = new HierarchicalChunker()
    let chunks: Chunk[] = []

    for (const doc of docs) {
      const docChunks = chunker.chunkDocument(doc, docId)
      chunks.push(...docChunks)
    }

    if (llm) {
      onProgress?.({ phase: 'summarizing', filename, progress: 0.5 })
      chunks = await generateParentSummaries(chunks, llm)
    }

    for (const chunk of chunks) {
      chunk.metadata = {
        ...chunk.metadata,
        docId,
        filename,
        indexedAt: new Date().toISOString(),
      }
    }

    onProgress?.({ phase: 'embedding', filename, progress: 0.7 })

    this.documentStore.addChunks(chunks)
    this.bm25Engine.buildIndex(this.documentStore.getAllChunks())

    await this.vectorStore.addDocuments(chunks)

    onProgress?.({ phase: 'embedding', filename, progress: 0.9 })
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

    this.documentStore.removeByDocId(docId)
    this.bm25Engine.buildIndex(this.documentStore.getAllChunks())

    this.indexedDocs.splice(idx, 1)
    this.persistMeta()
    return true
  }

  async reset(): Promise<void> {
    this.indexedDocs = []
    this.persistMeta()
    this.documentStore.clear()
    this.bm25Engine.clear()
  }
}
