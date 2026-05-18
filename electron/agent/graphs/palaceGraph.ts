import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../providers/index.js'
import { AnalyzeAgent } from '../agenthub/analyzeAgent.js'
import { ImageGenAgent } from '../agenthub/imageGenAgent.js'
import { AnchorAgent } from '../agenthub/anchorAgent.js'
import { PalaceSubgraphState } from '../state.js'

// ===== 配置选项 =====

export interface PalaceSubgraphOptions {
  provider: LLMProvider
}

// ===== Subgraph 构建器 =====

/**
 * 构建 Palace Subgraph
 * 流程: START -> analyze -> imageGen -> vision -> END
 */
export function buildPalaceSubgraph(options: PalaceSubgraphOptions) {
  const { provider } = options

  const analyze = new AnalyzeAgent(provider)
  const imageGen = new ImageGenAgent(provider)
  const vision = new AnchorAgent(provider)

  // 使用 Palace 子图专用状态类型
  const graph = new StateGraph(PalaceSubgraphState)
    .addNode('analyze', async (state) => {
      const result = await analyze.invoke(state)
      return result
    })
    .addNode('imageGen', async (state) => {
      return imageGen.invoke(state)
    })
    .addNode('vision', (state) => vision.invoke(state))

  // 基础边
  graph.addEdge(START, 'analyze')
  graph.addEdge('analyze', 'imageGen')
  graph.addEdge('imageGen', 'vision')
  graph.addEdge('vision', END)

  return graph
}
