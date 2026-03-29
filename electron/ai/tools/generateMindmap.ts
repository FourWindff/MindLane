import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import { runDocToMindmap } from '../../workflows/docToMindmap.js'
import type { MindLaneNode, MindLaneEdge } from '../../../src/shared/lib/fileFormat.js'

export interface MindmapToolResult {
  success: boolean
  title: string
  nodes: MindLaneNode[]
  edges: MindLaneEdge[]
  topics: string[]
}

export function createGenerateMindmapTool(apiKey: string, model: string) {
  return tool(
    async ({ content, title }) => {
      try {
        const result = await runDocToMindmap({
          apiKey,
          model,
          documentText: content,
          documentFilename: title ?? '用户输入',
        })

        if (!result.ok) return `生成失败: ${result.error}`

        const nodes: MindLaneNode[] = result.nodes.map((n) => {
          if (n.type === 'document') {
            return {
              id: n.id,
              type: 'document' as const,
              position: n.position,
              data: {
                filename: (n.data as { filename?: string }).filename ?? '',
                excerpt: (n.data as { excerpt?: string }).excerpt ?? '',
                fullTextPath: (n.data as { fullTextPath?: string }).fullTextPath,
              },
            }
          }
          return {
            id: n.id,
            type: 'topic' as const,
            position: n.position,
            data: {
              label: (n.data as { label?: string }).label ?? '',
            },
          }
        })

        const edges: MindLaneEdge[] = result.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
        }))

        const topics = nodes
          .filter((n): n is Extract<MindLaneNode, { type: 'topic' }> => n.type === 'topic')
          .map((n) => n.data.label)
          .filter((l) => l.length > 0)

        const toolResult: MindmapToolResult = {
          success: true,
          title: result.documentTitle,
          nodes,
          edges,
          topics,
        }

        return JSON.stringify(toolResult)
      } catch (err) {
        return `生成思维导图异常: ${err instanceof Error ? err.message : String(err)}`
      }
    },
    {
      name: 'generateMindmap',
      description:
        '根据文本内容生成思维导图结构。当用户要求创建、生成思维导图时使用此工具。返回的节点和边会自动应用到画布上。',
      schema: z.object({
        content: z.string().describe('要生成思维导图的文本内容'),
        title: z.string().optional().describe('思维导图标题'),
      }),
    },
  )
}
