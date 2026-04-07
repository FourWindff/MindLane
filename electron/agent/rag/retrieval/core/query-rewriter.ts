import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { QueryRewriteResult } from '../../types.js'

interface QueryRewriterOptions {
  model: BaseChatModel
  maxQueries?: number
}

export class QueryRewriter {
  private model: BaseChatModel
  private maxQueries: number

  constructor(options: QueryRewriterOptions) {
    this.model = options.model
    this.maxQueries = options.maxQueries ?? 3
  }

  async rewrite(query: string): Promise<QueryRewriteResult> {
    try {
      const prompt = `将以下查询改写为${this.maxQueries}个不同角度的搜索查询，每行一个，只输出查询内容：\n\n${query}`
      const response = await this.model.invoke(prompt)
      const text =
        typeof response.content === 'string' ? response.content : String(response.content)

      const searchQueries = text
        .split('\n')
        .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
        .filter((l) => l.length > 0)
        .slice(0, this.maxQueries)

      if (searchQueries.length === 0) {
        searchQueries.push(query)
      }

      return { originalQuery: query, searchQueries }
    } catch {
      return { originalQuery: query, searchQueries: [query] }
    }
  }
}
