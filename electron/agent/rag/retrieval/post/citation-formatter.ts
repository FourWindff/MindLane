import type { ScoredChunk, Citation } from '../../types.js'

export class CitationFormatter {
  formatWithCitations(chunks: ScoredChunk[]): { context: string; citations: Citation[] } {
    const citations: Citation[] = []
    const contextParts: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].chunk
      const citationId = i + 1

      citations.push({
        id: citationId,
        source: chunk.metadata.filename,
        page: chunk.metadata.pageNumber,
        path: chunk.metadata.path,
        chunkId: chunk.id,
      })

      contextParts.push(`[${citationId}] ${chunk.content}`)
    }

    return {
      context: contextParts.join('\n\n'),
      citations,
    }
  }
}
