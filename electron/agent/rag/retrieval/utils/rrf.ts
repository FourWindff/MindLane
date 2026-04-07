import type { ScoredChunk } from '../../types.js'

interface RRFInput {
  chunk: { id: string; score?: number; [key: string]: unknown }
  rank: number
  source: 'vector' | 'bm25'
}

/**
 * Reciprocal Rank Fusion — combine results from multiple retrieval methods.
 */
export function reciprocalRankFusion(
  results: RRFInput[],
  k: number = 60,
): ScoredChunk[] {
  const fusedScores = new Map<string, { score: number; chunk: unknown }>()

  for (const result of results) {
    const id = result.chunk.id
    const rrfScore = 1 / (k + result.rank)

    const existing = fusedScores.get(id)
    if (existing) {
      existing.score += rrfScore
    } else {
      fusedScores.set(id, { score: rrfScore, chunk: result.chunk })
    }
  }

  return Array.from(fusedScores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ score, chunk }) => ({
      chunk: chunk as ScoredChunk['chunk'],
      score,
    }))
}
