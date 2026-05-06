import type { Chunk } from '../types.js'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../../../shared/logger.js'



export class DocumentStore {
  private chunks: Map<string, Chunk> = new Map()
  private storeDir = ''

  get count(): number {
    return this.chunks.size
  }

  init(userDataPath: string): void {
    this.storeDir = path.join(userDataPath, 'vectorstore-v2')
    fs.mkdirSync(this.storeDir, { recursive: true })
    this.loadFromDisk()
    logger.debug(`DocumentStore 初始化完成，当前 chunk 数: ${this.chunks.size}`)
  }

  addChunks(chunks: Chunk[]): void {
    logger.debug(`添加 ${chunks.length} 个 chunks，当前总数: ${this.chunks.size} -> ${this.chunks.size + chunks.length}`)
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk)
    }
    this.saveToDisk()
  }

  getChunk(id: string): Chunk | undefined {
    return this.chunks.get(id)
  }

  getAllChunks(): Chunk[] {
    return Array.from(this.chunks.values())
  }

  removeByDocId(docId: string): void {
    let removedCount = 0
    for (const [id, chunk] of this.chunks) {
      if (chunk.metadata.docId === docId) {
        this.chunks.delete(id)
        removedCount++
      }
    }
    logger.debug(`删除 docId=${docId} 的 chunks，共删除 ${removedCount} 个，剩余 ${this.chunks.size} 个`)
    this.saveToDisk()
  }

  clear(): void {
    const prevCount = this.chunks.size
    this.chunks.clear()
    logger.debug(`清空所有 chunks，原数量: ${prevCount}`)
    this.saveToDisk()
  }

  private loadFromDisk(): void {
    const filePath = path.join(this.storeDir, 'document-store.json')
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        this.chunks = new Map(data)
        logger.debug(`从磁盘加载 chunks: ${this.chunks.size} 个`)
      } else {
        logger.debug('磁盘上无 chunks 数据，初始化为空')
      }
    } catch {
      logger.warn('加载 chunks 失败，初始化为空')
      this.chunks = new Map()
    }
  }

  private saveToDisk(): void {
    if (!this.storeDir) return
    const filePath = path.join(this.storeDir, 'document-store.json')
    fs.writeFileSync(
      filePath,
      JSON.stringify(Array.from(this.chunks.entries()), null, 2),
      'utf-8',
    )
    logger.debug(`保存 chunks 到磁盘: ${this.chunks.size} 个`)
  }
}
