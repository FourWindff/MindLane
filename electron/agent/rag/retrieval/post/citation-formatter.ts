import type { ScoredChunk, Citation } from '../../types.js'
import { logger } from '../../../../shared/logger.js'


export class CitationFormatter {
  formatWithCitations(chunks: ScoredChunk[]): { context: string; citations: Citation[] } {
    logger.debug(`开始格式化引用，输入 ${chunks.length} 个 chunks`)

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

    const totalLength = contextParts.join('\n\n').length
    logger.debug(`引用格式化完成，生成 ${citations.length} 个引用，总内容长度: ${totalLength}`)

    return {
      context: contextParts.join('\n\n'),
      citations,
    }
  }
}
