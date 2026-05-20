import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../providers/index.js'
import { MindmapSubgraphState } from '../state.js'
import { buildExtractStructureMessages } from '../agenthub/prompts/docToMindmap.js'
import { extractTextContent, formatAgentError } from '../utils.js'
import { extractYaml, sanitizeTreeCandidate, normalizeTree } from '../utils/yamlMindmap.js'
import type { MindmapYamlNode } from '../utils/yamlMindmap.js'

// ===== 配置选项 =====

export interface MindmapSubgraphOptions {
  provider: LLMProvider
}

// ===== 类型定义 =====

/**
 * 递归扁平化 MindmapYamlNode 树为 GeneratedNode/GeneratedEdge
 */
function flattenYamlTree(
  nodes: MindmapYamlNode[],
  parentId: string,
  genId: (prefix: string) => string,
): { nodes: Array<{ id: string; type: 'text'; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; type: string }> } {
  const resultNodes: Array<{ id: string; type: 'text'; data: Record<string, unknown> }> = []
  const resultEdges: Array<{ id: string; source: string; target: string; type: string }> = []

  for (const node of nodes) {
    const nodeId = genId('text')
    const data: Record<string, unknown> = { label: node.label }
    if (node.summary) data.summary = node.summary

    resultNodes.push({
      id: nodeId,
      type: 'text',
      data,
    })
    resultEdges.push({
      id: `e-${parentId}-${nodeId}`,
      source: parentId,
      target: nodeId,
      type: 'smoothstep',
    })

    if (node.children && node.children.length > 0) {
      const sub = flattenYamlTree(node.children, nodeId, genId)
      resultNodes.push(...sub.nodes)
      resultEdges.push(...sub.edges)
    }
  }

  return { nodes: resultNodes, edges: resultEdges }
}

/**
 * 从 sanitizeTreeCandidate 的结果中提取 MindmapYamlNode 根节点
 */
function extractRootTree(treeCandidate: unknown, fallbackTitle: string): MindmapYamlNode | null {
  if (!treeCandidate || typeof treeCandidate !== 'object') {
    return null
  }

  // Single structured/outline tree
  if ('label' in (treeCandidate as Record<string, unknown>) && typeof (treeCandidate as Record<string, unknown>).label === 'string') {
    return normalizeTree(treeCandidate as MindmapYamlNode, '')
  }

  // Array of trees — wrap in virtual root
  if (Array.isArray(treeCandidate)) {
    const children = treeCandidate
      .filter((item): item is MindmapYamlNode =>
        item !== null && typeof item === 'object' && 'label' in item && typeof (item as Record<string, unknown>).label === 'string',
      )
      .map((item) => normalizeTree(item, ''))

    if (children.length === 0) return null

    return {
      label: fallbackTitle,
      page_range: '',
      children,
    }
  }

  // Single object without label (should not happen after sanitizeTreeCandidate)
  return null
}

// ===== Subgraph 构建器 =====

/**
 * 构建 Mindmap Subgraph
 * 流程: START -> generate -> END
 */
export function buildMindmapSubgraph(options: MindmapSubgraphOptions) {
  const { provider } = options

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

        const parsedYaml = extractYaml(extractContent)
        const treeCandidate = sanitizeTreeCandidate(parsedYaml)
        const rootTree = extractRootTree(treeCandidate, title)

        if (!rootTree) {
          return {
            error: 'AI 未返回有效的思维导图结构',
            response: '生成思维导图失败：无法解析结构',
          }
        }

        const finalTitle = rootTree.label || title

        if (!rootTree.children || rootTree.children.length === 0) {
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

        const tree = flattenYamlTree(rootTree.children, rootId, genId)

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
          response: `生成思维导图失败：${formatted.split('\n')[0]}`,
        }
      }
    })

  graph.addEdge(START, 'generate')
  graph.addEdge('generate', END)

  return graph
}
