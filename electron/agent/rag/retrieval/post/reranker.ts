import type { ScoredChunk } from '../../types.js'
import { tokenize } from '../utils/tokenizer.js'
import { jaccardSimilarity } from '../utils/similarity.js'
import { logger } from '../../../../shared/logger.js'


export class LocalReranker {
  rerank(query: string, chunks: ScoredChunk[], topK?: number): ScoredChunk[] {
    const startTime = Date.now()
    logger.debug(`开始重排序，输入 ${chunks.length} 个结果，topK=${topK ?? 'all'}`)

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
    const result = topK ? scored.slice(0, topK) : scored

    logger.debug(`重排序完成，耗时 ${Date.now() - startTime}ms，输出 ${result.length} 个结果`)
    return result
  }
}
