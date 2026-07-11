import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../providers/index.js'
import { AnalyzeAgent } from '../agenthub/analyzeAgent.js'
import { ImageGenAgent } from '../agenthub/imageGenAgent.js'
import { AnchorAgent } from '../agenthub/anchorAgent.js'
import { PalaceSubgraphState } from '../state.js'

import { PalaceInputResolver } from './palaceGraph/inputResolver.js'
import { normalizePalaceImageUrls } from './palaceGraph/normalizeImageUrls.js'

// ===== 配置选项 =====

interface PalaceSubgraphOptions {
  provider: LLMProvider
}

// ===== Subgraph 构建器 =====

/**
 * 构建 Palace Subgraph
 * 流程: START -> resolve_input -> analyze -> imageGen -> normalizeImages -> vision -> END
 */
export function buildPalaceSubgraph(options: PalaceSubgraphOptions) {
  const { provider } = options

  const analyze = new AnalyzeAgent(provider)
  const imageGen = new ImageGenAgent(provider)
  const vision = new AnchorAgent(provider)
  const inputResolver = new PalaceInputResolver()

  // 使用 Palace 子图专用状态类型
  const graph = new StateGraph(PalaceSubgraphState)
    .addNode('resolve_input', async (state) => {
      const resolution = await inputResolver.resolve(state)
      if (!resolution) {
        return {
          error: '请提供记忆宫殿的输入内容。',
          response: '请提供记忆宫殿的输入内容。',
        }
      }
      return {
        palaceInputNodes: resolution.palaceInputNodes,
        palaceInputText: resolution.palaceInputText,
      }
    })
    .addNode('analyze', async (state) => {
      const result = await analyze.invoke(state)
      return result
    })
    .addNode('imageGen', async (state) => {
      return imageGen.invoke(state)
    })
    .addNode('normalizeImages', (state) => normalizePalaceImageUrls(state))
    .addNode('vision', (state) => vision.invoke(state))

  // 基础边
  graph.addEdge(START, 'resolve_input')
  graph.addConditionalEdges('resolve_input', (state) => (state.error ? END : 'analyze'), [
    'analyze',
    END,
  ])
  graph.addEdge('analyze', 'imageGen')
  graph.addEdge('imageGen', 'normalizeImages')
  graph.addEdge('normalizeImages', 'vision')
  graph.addEdge('vision', END)

  return graph
}
