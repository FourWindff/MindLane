import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { Chunk } from '../../types.js'

/**
 * Calculate target summary length based on content size
 */
export function getSummaryLength(contentLength: number): number {
  if (contentLength < 500) return 50
  if (contentLength < 2000) return 150
  if (contentLength < 5000) return 250
  return 300
}

/**
 * Generate summary for parent chunks using LLM
 */
export async function generateParentSummaries(
  chunks: Chunk[],
  llm: BaseChatModel
): Promise<Chunk[]> {
  const parentChunks = chunks.filter((c) => c.level === 1)

  for (const parent of parentChunks) {
    const targetLength = getSummaryLength(parent.content.length)
    const sentenceCount = Math.ceil(targetLength / 50)

    const prompt = `用${sentenceCount}句话概括以下内容（约${targetLength}字），保留关键术语：

${parent.content.slice(0, 3000)}

只输出概括内容，不要任何解释。`

    try {
      const response = await llm.invoke(prompt)
      parent.summary = String(response.content).trim()
    } catch (error) {
      console.error('Failed to generate summary:', error)
      // Fallback to truncation
      parent.summary = parent.content.slice(0, targetLength) + '...'
    }
  }

  return chunks
}
