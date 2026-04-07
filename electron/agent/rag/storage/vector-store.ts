import { HNSWLib } from '@langchain/community/vectorstores/hnswlib'
import type { EmbeddingsInterface } from '@langchain/core/embeddings'
import type { Chunk } from '../types.js'
import path from 'node:path'
import fs from 'node:fs'

/**
 * VectorStoreManager wraps HNSWLib with Chunk type support.
 * Storage path: vectorstore-v2/
 */
export class VectorStoreManager {
  private instance: HNSWLib | null = null
  private storeDir = ''
  private docIdToChunkId: Map<string, string> = new Map()

  async init(userDataPath: string, embeddings: EmbeddingsInterface): Promise<void> {
    this.storeDir = path.join(userDataPath, 'vectorstore-v2')
    await fs.promises.mkdir(this.storeDir, { recursive: true })

    const indexPath = path.join(this.storeDir, 'hnswlib.index')

    if (fs.existsSync(indexPath)) {
      this.instance = await HNSWLib.load(this.storeDir, embeddings)
    } else {
      this.instance = new HNSWLib(embeddings, { space: 'cosine' })
    }

    // Load chunk mapping if exists
    await this.loadChunkMapping()
  }

  get(): HNSWLib | null {
    return this.instance
  }

  /**
   * Add documents to vector store
   */
  async addDocuments(chunks: Chunk[]): Promise<void> {
    if (!this.instance) throw new Error('Vector store not initialized')

    // Convert chunks to LangChain Documents
    const docs = chunks.map(chunk => ({
      pageContent: chunk.content,
      metadata: {
        chunkId: chunk.id,
        docId: chunk.metadata.docId,
        filename: chunk.metadata.filename,
        pageNumber: chunk.metadata.pageNumber,
        sectionTitle: chunk.metadata.sectionTitle,
        path: chunk.metadata.path,
        nodeId: chunk.metadata.nodeId,
        level: chunk.level,
      }
    }))

    await this.instance.addDocuments(docs)

    // Update mapping
    for (const chunk of chunks) {
      this.docIdToChunkId.set(chunk.id, chunk.metadata.docId)
    }

    await this.saveChunkMapping()
  }

  /**
   * Similarity search returning Chunk objects
   */
  async similaritySearch(query: string, k: number): Promise<Array<{ chunk: Chunk; score: number }>> {
    if (!this.instance) throw new Error('Vector store not initialized')

    const results = await this.instance.similaritySearchWithScore(query, k)

    return results.map(([doc, score]) => {
      const metadata = doc.metadata
      const chunk: Chunk = {
        id: metadata.chunkId,
        content: doc.pageContent,
        level: metadata.level ?? 2,
        metadata: {
          docId: metadata.docId,
          filename: metadata.filename,
          source: metadata.filename,
          pageNumber: metadata.pageNumber,
          sectionTitle: metadata.sectionTitle,
          path: metadata.path ?? [],
          nodeId: metadata.nodeId,
          charCount: doc.pageContent.length,
          indexedAt: new Date().toISOString(),
        }
      }
      return { chunk, score }
    })
  }

  /**
   * Save index and mapping
   */
  async save(): Promise<void> {
    if (this.instance && this.storeDir) {
      await this.instance.save(this.storeDir)
      await this.saveChunkMapping()
    }
  }

  /**
   * Reset index
   */
  async reset(embeddings: EmbeddingsInterface): Promise<HNSWLib> {
    this.instance = new HNSWLib(embeddings, { space: 'cosine' })
    this.docIdToChunkId.clear()

    if (this.storeDir) {
      await this.instance.save(this.storeDir)
      await this.saveChunkMapping()
    }

    return this.instance
  }

  private async loadChunkMapping(): Promise<void> {
    const mappingPath = path.join(this.storeDir, 'chunk-mapping.json')
    if (fs.existsSync(mappingPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'))
        this.docIdToChunkId = new Map(data)
      } catch {
        this.docIdToChunkId = new Map()
      }
    }
  }

  private async saveChunkMapping(): Promise<void> {
    const mappingPath = path.join(this.storeDir, 'chunk-mapping.json')
    fs.writeFileSync(
      mappingPath,
      JSON.stringify(Array.from(this.docIdToChunkId.entries()), null, 2),
      'utf-8'
    )
  }
}
