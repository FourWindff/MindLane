import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../../providers/index.js'
import { MindmapSubgraphState } from '../../state.js'
import { buildExtractStructureMessages } from '../../agenthub/prompts/docToMindmap.js'
import { extractTextContent, formatAgentError } from '../../utils.js'
import { extractYaml, sanitizeTreeCandidate } from '../../utils/yamlMindmap.js'
import { flattenYamlTree, extractRootTree } from './shared/flattenTree.js'

// ===== 配置选项 =====

export interface MindmapSubgraphOptions {
  provider: LLMProvider
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

        const rootId = genId('root')

        const rootNode = {
          id: rootId,
          type: 'text' as const,
          data: { label: finalTitle },
        }

        const tree = flattenYamlTree(rootTree.children, rootId, genId)

        return {
          mindmapNodes: [rootNode, ...tree.nodes],
          mindmapEdges: tree.edges,
          mindmapTitle: finalTitle,
          response: `已生成思维导图「${finalTitle}」，共 ${tree.nodes.length + 1} 个节点。`,
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
