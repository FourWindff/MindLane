import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import { type LLMProvider, ProviderCapability } from '../providers/index.js'
import { VectorStoreManager } from './storage/vector-store.js'
import { DocumentStore } from './storage/document-store.js'
import { BM25SearchEngine } from './retrieval/core/bm25.js'
import { HybridRetriever } from './retrieval/core/hybrid-retriever.js'
import { QueryRewriter } from './retrieval/core/query-rewriter.js'
import { CitationFormatter } from './retrieval/post/citation-formatter.js'
import { DocumentIndexer, type IndexedDocMeta, type IndexProgressCallback } from './indexer.js'
import { loadDocument } from './prepare/loaders.js'
import { logger } from '../../shared/logger.js'

export class RAGManager {
  private vectorStore = new VectorStoreManager()
  private documentStore = new DocumentStore()
  private bm25Engine = new BM25SearchEngine()
  private hybridRetriever: HybridRetriever | null = null
  private indexer: DocumentIndexer | null = null
  private provider: LLMProvider | null = null

  async init(userDataPath: string, provider?: LLMProvider): Promise<void> {
    logger.info('正在初始化 RAGManager...')

    this.provider = provider ?? null

    this.documentStore.init(userDataPath)
    this.bm25Engine.init(userDataPath)

    const allChunks = this.documentStore.getAllChunks()
    if (allChunks.length > 0) {
      logger.info(`加载了 ${allChunks.length} 个已有文档片段`)
      this.bm25Engine.buildIndex(allChunks)
    }

    if (provider?.capabilities.has(ProviderCapability.Embeddings)) {
      logger.info('正在初始化向量存储...')
      const embeddings = provider.createEmbeddings()
      await this.vectorStore.init(userDataPath, embeddings)

      this.hybridRetriever = new HybridRetriever({
        vectorStore: this.vectorStore,
        bm25Engine: this.bm25Engine,
      })
      logger.info('混合检索器已初始化')
    } else if (provider) {
      logger.info('当前 provider 不支持 embeddings，跳过向量存储初始化')
    }

    this.indexer = new DocumentIndexer(
      this.vectorStore,
      this.documentStore,
      this.bm25Engine,
    )
    this.indexer.init(userDataPath)

    logger.info('RAGManager 初始化完成')
  }

  async index(
    filePath: string,
    onProgress?: IndexProgressCallback,
  ): Promise<IndexedDocMeta> {
    if (!this.indexer) throw new Error('RAG 未初始化')

    logger.info(`开始索引文档: ${filePath}`)

    const visionModel = this.provider?.visionModel
    const llm = this.provider?.reasoningModel

    const result = await this.indexer.index(
      filePath,
      (fp) => loadDocument(fp, visionModel),
      llm,
      onProgress,
    )
    logger.info(`文档索引完成: ${result.filename} (${result.chunkCount} 个片段)`)
    return result
  }

  list(): IndexedDocMeta[] {
    return this.indexer?.list() ?? []
  }

  async remove(docId: string): Promise<boolean> {
    if (!this.indexer) return false
    return this.indexer.remove(docId)
  }

  createSearchTools() {
    const indexer = this.indexer
    const documentStore = this.documentStore
    const hybridRetriever = this.hybridRetriever
    const provider = this.provider

    const listKnowledgeBaseTool = tool(
      async () => {
        const docs = indexer?.list() ?? []
        if (docs.length === 0) return '知识库为空，用户尚未导入任何文档。'

        const lines = docs.map((doc, i) => {
          const date = new Date(doc.indexedAt).toLocaleDateString('zh-CN')
          return `${i + 1}. ${doc.filename} (${doc.chunkCount}个片段, 索引于 ${date})`
        })

        return `知识库共有 ${docs.length} 个文档：\n${lines.join('\n')}`
      },
      {
        name: 'listKnowledgeBase',
        description: '列出用户知识库中已索引的所有文档。当用户询问知识库内容、有哪些文档、知识库状态时使用。',
        schema: z.object({}),
      },
    )

    const searchDocumentsTool = tool(
      async ({ query, k }) => {
        if (documentStore.count === 0) {
          logger.warn('搜索时知识库为空')
          return '知识库为空，用户尚未导入任何文档。'
        }

        if (!hybridRetriever || !provider) {
          logger.error('搜索时知识库检索未初始化')
          return '知识库检索未初始化。'
        }

        try {
          logger.debug(`开始检索查询: "${query}" (k=${k ?? 4})`)

          const queryRewriter = new QueryRewriter({ model: provider.reasoningModel, maxQueries: 3 })
          const citationFormatter = new CitationFormatter()

          const { searchQueries } = await queryRewriter.rewrite(query)
          logger.debug(`查询重写结果: ${searchQueries.length} 个查询`)

          const chunks = await hybridRetriever.searchMultiple(searchQueries, {
            topK: k ?? 4,
          })

          if (chunks.length === 0) {
            logger.info(`未找到相关文档内容，查询: "${query}"`)
            return '未找到相关文档内容。'
          }

          logger.debug(`检索完成，找到 ${chunks.length} 个片段`)

          const { context, citations } = citationFormatter.formatWithCitations(chunks)

          const citationInfo = citations
            .map((c) => {
              const location = c.page
                ? `(p.${c.page})`
                : c.path
                  ? `(${c.path.join(' > ')})`
                  : ''
              return `[${c.id}] ${c.source} ${location}`
            })
            .join('\n')

          return `${context}\n\n---\n引用列表:\n${citationInfo}`
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error(`检索失败: ${errorMsg}`)
          return `检索失败: ${errorMsg}`
        }
      },
      {
        name: 'searchDocuments',
        description: '在用户的知识库中检索相关文档片段。支持语义理解和关键词匹配，自动重写查询以提高召回率。返回带引用标记的结果，使用 [1], [2] 等标记引用来源。',
        schema: z.object({
          query: z.string().describe('检索查询内容'),
          k: z.number().optional().describe('返回结果数量，默认4'),
        }),
      },
    )

    return { listKnowledgeBaseTool, searchDocumentsTool }
  }

  isReady(): boolean {
    return this.hybridRetriever !== null && this.indexer !== null
  }

  hasDocuments(): boolean {
    return this.documentStore.count > 0
  }
}
