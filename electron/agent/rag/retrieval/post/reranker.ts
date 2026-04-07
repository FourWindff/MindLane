import type { ScoredChunk } from '../../types.js'
import { tokenize } from '../utils/tokenizer.js'
import { jaccardSimilarity } from '../utils/similarity.js'

export class LocalReranker {
  rerank(query: string, chunks: ScoredChunk[], topK?: number): ScoredChunk[] {
    const queryTokens = tokenize(query)

    const scored = chunks.map((item) => {
      const chunkTokens = tokenize(item.chunk.content)
      const similarity = jaccardSimilarity(queryTokens, chunkTokens)
      return {
        ...item,
        score: item.score * 0.7 + similarity * 0.3,
      }
    })

    scored.sort((a, b) => b.score - a.score)
    return topK ? scored.slice(0, topK) : scored
  }
}
