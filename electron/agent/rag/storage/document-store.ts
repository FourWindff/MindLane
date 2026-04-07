import type { Chunk } from '../types.js'
import fs from 'node:fs'
import path from 'node:path'

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
  }

  addChunks(chunks: Chunk[]): void {
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
    for (const [id, chunk] of this.chunks) {
      if (chunk.metadata.docId === docId) {
        this.chunks.delete(id)
      }
    }
    this.saveToDisk()
  }

  clear(): void {
    this.chunks.clear()
    this.saveToDisk()
  }

  private loadFromDisk(): void {
    const filePath = path.join(this.storeDir, 'document-store.json')
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        this.chunks = new Map(data)
      }
    } catch {
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
  }
}
