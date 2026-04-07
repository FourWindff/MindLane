import type { VectorStoreManager } from '../../storage/vector-store.js'
import type { BM25SearchEngine } from './bm25.js'
import type { ScoredChunk, SearchOptions } from '../../types.js'
import { reciprocalRankFusion } from '../utils/rrf.js'

interface HybridRetrieverOptions {
  vectorStore: VectorStoreManager
  bm25Engine: BM25SearchEngine
}

export class HybridRetriever {
  private vectorStore: VectorStoreManager
  private bm25Engine: BM25SearchEngine

  constructor(options: HybridRetrieverOptions) {
    this.vectorStore = options.vectorStore
    this.bm25Engine = options.bm25Engine
  }

  async search(query: string, options: SearchOptions = {}): Promise<ScoredChunk[]> {
    const topK = options.topK ?? 5

    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorStore.similaritySearch(query, topK),
      Promise.resolve(this.bm25Engine.search(query, topK)),
    ])

    const rrfInput = [
      ...vectorResults.map((r, i) => ({
        chunk: { ...r.chunk, score: r.score },
        rank: i + 1,
        source: 'vector' as const,
      })),
      ...bm25Results.map((r, i) => ({
        chunk: { ...r.chunk, score: r.score },
        rank: i + 1,
        source: 'bm25' as const,
      })),
    ]

    return reciprocalRankFusion(rrfInput, 60).slice(0, topK)
  }

  async searchMultiple(queries: string[], options: SearchOptions = {}): Promise<ScoredChunk[]> {
    const allResults: ScoredChunk[] = []
    for (const query of queries) {
      const results = await this.search(query, options)
      allResults.push(...results)
    }

    const seen = new Set<string>()
    return allResults.filter((r) => {
      if (seen.has(r.chunk.id)) return false
      seen.add(r.chunk.id)
      return true
    })
  }
}
