import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../providers/index.js'
import { AnalyzeAgent } from '../agenthub/analyzeAgent.js'
import { ImageGenAgent } from '../agenthub/imageGenAgent.js'
import { AnchorAgent } from '../agenthub/anchorAgent.js'
import { PalaceSubgraphState } from '../state.js'

import type { CacheManager } from '../../fs/cacheManager.js'
import { PalaceInputResolver } from './palaceGraph/inputResolver.js'

// ===== 配置选项 =====

interface PalaceSubgraphOptions {
  provider: LLMProvider
  cacheManager?: CacheManager
}

// ===== Subgraph 构建器 =====

/**
 * 构建 Palace Subgraph
 * 流程: START -> resolve_input -> analyze -> imageGen -> vision -> END
 */
export function buildPalaceSubgraph(options: PalaceSubgraphOptions) {
  const { provider, cacheManager } = options

  const analyze = new AnalyzeAgent(provider)
  const imageGen = new ImageGenAgent(provider)
  const vision = new AnchorAgent(provider)
  const inputResolver = new PalaceInputResolver(cacheManager)

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
    .addNode('vision', (state) => vision.invoke(state))

  // 基础边
  graph.addEdge(START, 'resolve_input')
  graph.addConditionalEdges('resolve_input', (state) => (state.error ? END : 'analyze'), [
    'analyze',
    END,
  ])
  graph.addEdge('analyze', 'imageGen')
  graph.addEdge('imageGen', 'vision')
  graph.addEdge('vision', END)

  return graph
}
