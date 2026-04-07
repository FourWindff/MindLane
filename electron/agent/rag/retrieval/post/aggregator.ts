import type { ScoredChunk } from '../../types.js'
import { logger } from '../../../../shared/logger.js'


export class ResultAggregator {
  aggregate(results: ScoredChunk[]): ScoredChunk[] {
    logger.debug(`开始聚合结果，输入 ${results.length} 个结果`)

    const deduped = new Map<string, ScoredChunk>()

    for (const result of results) {
      const existing = deduped.get(result.chunk.id)
      if (!existing || result.score > existing.score) {
        deduped.set(result.chunk.id, result)
      }
    }

    const aggregated = Array.from(deduped.values()).sort((a, b) => b.score - a.score)
    logger.debug(`聚合完成，去重后 ${aggregated.length} 个结果 (去重 ${results.length - aggregated.length} 个)`)

    return aggregated
  }
}
