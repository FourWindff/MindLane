import type { Chunk, ScoredChunk } from '../../types.js'
import { tokenize } from '../utils/tokenizer.js'
import fs from 'node:fs'
import path from 'node:path'

export class BM25SearchEngine {
  private docs: Chunk[] = []
  private tokenizedDocs: string[][] = []
  private avgDl = 0
  private idf: Map<string, number> = new Map()
  private storeDir = ''

  private k1 = 1.5
  private b = 0.75

  get docCount(): number {
    return this.docs.length
  }

  init(userDataPath: string): void {
    this.storeDir = path.join(userDataPath, 'vectorstore-v2')
    fs.mkdirSync(this.storeDir, { recursive: true })
  }

  buildIndex(chunks: Chunk[]): void {
    this.docs = chunks
    this.tokenizedDocs = chunks.map((c) => tokenize(c.content))

    const totalTokens = this.tokenizedDocs.reduce((sum, doc) => sum + doc.length, 0)
    this.avgDl = totalTokens / Math.max(this.tokenizedDocs.length, 1)

    this.idf.clear()
    const termDocFreq = new Map<string, number>()

    for (const tokens of this.tokenizedDocs) {
      const unique = new Set(tokens)
      for (const token of unique) {
        termDocFreq.set(token, (termDocFreq.get(token) ?? 0) + 1)
      }
    }

    const N = this.docs.length
    for (const [term, df] of termDocFreq) {
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1))
    }
  }

  search(query: string, topK: number = 5): ScoredChunk[] {
    if (this.docs.length === 0) return []

    const queryTokens = tokenize(query)
    const scores: Array<{ index: number; score: number }> = []

    for (let i = 0; i < this.docs.length; i++) {
      const docTokens = this.tokenizedDocs[i]
      const dl = docTokens.length
      let score = 0

      for (const qt of queryTokens) {
        const idf = this.idf.get(qt) ?? 0
        const tf = docTokens.filter((t) => t === qt).length
        const numerator = tf * (this.k1 + 1)
        const denominator = tf + this.k1 * (1 - this.b + this.b * (dl / this.avgDl))
        score += idf * (numerator / denominator)
      }

      if (score > 0) {
        scores.push({ index: i, score })
      }
    }

    scores.sort((a, b) => b.score - a.score)

    return scores.slice(0, topK).map(({ index, score }) => ({
      chunk: this.docs[index],
      score,
      source: 'bm25' as const,
    }))
  }

  clear(): void {
    this.docs = []
    this.tokenizedDocs = []
    this.avgDl = 0
    this.idf.clear()
  }
}
