import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { QueryRewriteResult } from '../../types.js'
import { logger } from '../../../../shared/logger.js'

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
    const startTime = Date.now()
    logger.debug(`开始重写查询: "${query}"`)

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
        logger.warn(`查询重写结果为空，使用原查询: "${query}"`)
        searchQueries.push(query)
      } else {
        const duration = Date.now() - startTime
        logger.debug(`查询重写完成，耗时 ${duration}ms，生成 ${searchQueries.length} 个查询: ${searchQueries.join('; ')}`)
      }

      return { originalQuery: query, searchQueries }
    } catch (err) {
      const duration = Date.now() - startTime
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`查询重写失败 (耗时 ${duration}ms): ${errorMsg}，回退到原查询`)
      return { originalQuery: query, searchQueries: [query] }
    }
  }
}
