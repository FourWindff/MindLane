import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import { getVectorStore } from '../vectorstore/store.js'
import { listIndexedDocuments } from '../vectorstore/indexer.js'

export const listKnowledgeBaseTool = tool(
  async () => {
    const docs = listIndexedDocuments()
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

export const searchDocumentsTool = tool(
  async ({ query, k }) => {
    const store = getVectorStore()
    if (!store) return '知识库未初始化，无法检索。'

    try {
      const results = await store.similaritySearch(query, k ?? 4)
      if (results.length === 0) return '未找到相关文档内容。'

      return results
        .map((doc, i) => {
          const source = doc.metadata.filename ?? doc.metadata.source ?? '未知来源'
          return `[${i + 1}] 来源: ${source}\n${doc.pageContent}`
        })
        .join('\n\n---\n\n')
    } catch (err) {
      return `检索失败: ${err instanceof Error ? err.message : String(err)}`
    }
  },
  {
    name: 'searchDocuments',
    description: '在用户的知识库中按语义检索与查询相关的文档片段。适合在回答需要引用资料、查找特定信息时使用。',
    schema: z.object({
      query: z.string().describe('检索查询内容'),
      k: z.number().optional().describe('返回结果数量，默认4'),
    }),
  },
)
