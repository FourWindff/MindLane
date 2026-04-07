import type { ScoredChunk } from '../../types.js'

export class ResultAggregator {
  aggregate(results: ScoredChunk[]): ScoredChunk[] {
    const deduped = new Map<string, ScoredChunk>()

    for (const result of results) {
      const existing = deduped.get(result.chunk.id)
      if (!existing || result.score > existing.score) {
        deduped.set(result.chunk.id, result)
      }
    }

    return Array.from(deduped.values()).sort((a, b) => b.score - a.score)
  }
}
