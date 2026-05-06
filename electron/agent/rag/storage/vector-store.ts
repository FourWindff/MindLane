import { HNSWLib } from '@langchain/community/vectorstores/hnswlib'
import type { EmbeddingsInterface } from '@langchain/core/embeddings'
import type { Chunk } from '../types.js'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from '../../../shared/logger.js'

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
      logger.info(`加载已有向量索引: ${indexPath}`)
      const startTime = Date.now()
      this.instance = await HNSWLib.load(this.storeDir, embeddings)
      logger.info(`向量索引加载完成，耗时 ${Date.now() - startTime}ms`)
    } else {
      logger.info('创建新的向量索引')
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

    const startTime = Date.now()
    logger.debug(`开始添加 ${chunks.length} 个文档片段到向量存储`)

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

    logger.debug(`向量存储添加完成，耗时 ${Date.now() - startTime}ms，当前共 ${this.docIdToChunkId.size} 个片段`)
  }

  /**
   * Similarity search returning Chunk objects
   */
  async similaritySearch(query: string, k: number): Promise<Array<{ chunk: Chunk; score: number }>> {
    if (!this.instance) throw new Error('Vector store not initialized')

    const startTime = Date.now()
    logger.debug(`开始向量相似度搜索: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}" (k=${k})`)

    const results = await this.instance.similaritySearchWithScore(query, k)

    logger.debug(`向量搜索完成，耗时 ${Date.now() - startTime}ms，返回 ${results.length} 个结果`)

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
      const startTime = Date.now()
      logger.debug('开始保存向量索引...')
      await this.instance.save(this.storeDir)
      await this.saveChunkMapping()
      logger.debug(`向量索引保存完成，耗时 ${Date.now() - startTime}ms`)
    }
  }

  /**
   * Reset index
   */
  async reset(embeddings: EmbeddingsInterface): Promise<HNSWLib> {
    logger.info('重置向量索引')
    this.instance = new HNSWLib(embeddings, { space: 'cosine' })
    this.docIdToChunkId.clear()

    if (this.storeDir) {
      await this.instance.save(this.storeDir)
      await this.saveChunkMapping()
    }

    logger.info('向量索引重置完成')
    return this.instance
  }

  private async loadChunkMapping(): Promise<void> {
    const mappingPath = path.join(this.storeDir, 'chunk-mapping.json')
    if (fs.existsSync(mappingPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'))
        this.docIdToChunkId = new Map(data)
        logger.debug(`加载 chunk 映射: ${this.docIdToChunkId.size} 个条目`)
      } catch {
        logger.warn('加载 chunk 映射失败，初始化为空')
        this.docIdToChunkId = new Map()
      }
    } else {
      logger.debug('chunk 映射文件不存在，初始化为空')
    }
  }

  private async saveChunkMapping(): Promise<void> {
    const mappingPath = path.join(this.storeDir, 'chunk-mapping.json')
    fs.writeFileSync(
      mappingPath,
      JSON.stringify(Array.from(this.docIdToChunkId.entries()), null, 2),
      'utf-8'
    )
    logger.debug(`保存 chunk 映射: ${this.docIdToChunkId.size} 个条目`)
  }
}
