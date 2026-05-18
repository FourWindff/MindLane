import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../providers/index.js'
import { MindmapSubgraphState } from '../state.js'
import { buildExtractStructureMessages } from '../agenthub/prompts/docToMindmap.js'
import { extractTextContent, formatAgentError } from '../utils.js'

// ===== 配置选项 =====

export interface MindmapSubgraphOptions {
  provider: LLMProvider
}

// ===== 类型定义 =====

/**
 * 知识结构树节点
 */
interface KeyPoint {
  title: string
  children?: KeyPoint[]
}

/**
 * 递归扁平化树形结构为节点和边
 */
function flattenTree(
  points: KeyPoint[],
  parentId: string,
  genId: (prefix: string) => string,
): { nodes: Array<{ id: string; type: 'text'; data: { label: string } }>; edges: Array<{ id: string; source: string; target: string; type: string }> } {
  const nodes: Array<{ id: string; type: 'text'; data: { label: string } }> = []
  const edges: Array<{ id: string; source: string; target: string; type: string }> = []

  for (const point of points) {
    const nodeId = genId('text')
    nodes.push({
      id: nodeId,
      type: 'text',
      data: { label: point.title },
    })
    edges.push({
      id: `e-${parentId}-${nodeId}`,
      source: parentId,
      target: nodeId,
      type: 'smoothstep',
    })

    if (point.children && point.children.length > 0) {
      const sub = flattenTree(point.children, nodeId, genId)
      nodes.push(...sub.nodes)
      edges.push(...sub.edges)
    }
  }

  return { nodes, edges }
}

// ===== Subgraph 构建器 =====

/**
 * 构建 Mindmap Subgraph
 * 流程: START -> generate -> END
 */
export function buildMindmapSubgraph(options: MindmapSubgraphOptions) {
  const { provider } = options

  // 使用 Mindmap 子图专用状态类型
  const graph = new StateGraph(MindmapSubgraphState)
    .addNode('generate', async (state) => {
      const documentText = state.mindmapInputText
      const title = state.mindmapInputTitle || '思维导图'

      if (!documentText) {
        return {
          error: '请提供要生成思维导图的内容。',
          response: '请提供要生成思维导图的内容。',
        }
      }

      let nodeCounter = 0
      function genId(prefix: string): string {
        return `${prefix}-${Date.now()}-${++nodeCounter}`
      }

      try {
        const text = documentText.slice(0, 8000)
        const extractResponse = await provider.reasoningModel.invoke(
          buildExtractStructureMessages(text),
        )
        const extractContent = extractTextContent(extractResponse.content)

        const jsonMatch = extractContent.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          return {
            error: 'AI 未返回有效的 JSON 结构',
            response: '生成思维导图失败：无法解析结构',
          }
        }

        const parsed = JSON.parse(jsonMatch[0]) as {
          title?: string
          points?: KeyPoint[]
        }

        const finalTitle = parsed.title ?? title
        const points = parsed.points ?? []

        if (points.length === 0) {
          return {
            error: '未提取到任何要点',
            response: '生成思维导图失败：未提取到任何要点',
          }
        }

        const docNodeId = genId('doc')
        const rootId = genId('root')

        const docNode = {
          id: docNodeId,
          type: 'document' as const,
          data: {
            filename: title,
            excerpt: documentText.slice(0, 200),
          },
        }

        const rootNode = {
          id: rootId,
          type: 'text' as const,
          data: { label: finalTitle },
        }

        const docToRootEdge = {
          id: `e-${docNodeId}-${rootId}`,
          source: docNodeId,
          target: rootId,
          type: 'smoothstep',
        }

        const tree = flattenTree(points, rootId, genId)

        return {
          mindmapNodes: [docNode, rootNode, ...tree.nodes],
          mindmapEdges: [docToRootEdge, ...tree.edges],
          mindmapTitle: finalTitle,
          response: `已生成思维导图「${finalTitle}」，共 ${tree.nodes.length + 2} 个节点。`,
        }
      } catch (error) {
        const formatted = formatAgentError(error)
        return {
          error: formatted,
          response: `生成思维导图失败：${error instanceof Error ? error.message : String(error)}`,
        }
      }
    })

  graph.addEdge(START, 'generate')
  graph.addEdge('generate', END)

  return graph
}
