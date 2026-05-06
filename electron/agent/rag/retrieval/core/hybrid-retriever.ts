import type { VectorStoreManager } from '../../storage/vector-store.js'
import type { BM25SearchEngine } from './bm25.js'
import type { ScoredChunk, SearchOptions } from '../../types.js'
import { reciprocalRankFusion } from '../utils/rrf.js'
import { logger } from '../../../../shared/logger.js'

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
    logger.debug(`混合检索: "${query}" (k=${topK})`)

    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorStore.similaritySearch(query, topK),
      Promise.resolve(this.bm25Engine.search(query, topK)),
    ])

    logger.debug(`向量检索: ${vectorResults.length} 个结果, BM25: ${bm25Results.length} 个结果`)

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

    const fusedResults = reciprocalRankFusion(rrfInput, 60).slice(0, topK)
    logger.debug(`RRF 融合后: ${fusedResults.length} 个结果`)

    return fusedResults
  }

  async searchMultiple(queries: string[], options: SearchOptions = {}): Promise<ScoredChunk[]> {
    logger.debug(`多查询检索: ${queries.length} 个查询`)
    const allResults: ScoredChunk[] = []
    for (const query of queries) {
      const results = await this.search(query, options)
      allResults.push(...results)
    }

    const seen = new Set<string>()
    const dedupedResults = allResults.filter((r) => {
      if (seen.has(r.chunk.id)) return false
      seen.add(r.chunk.id)
      return true
    })

    logger.debug(`多查询去重后: ${dedupedResults.length} 个结果`)
    return dedupedResults
  }
}
