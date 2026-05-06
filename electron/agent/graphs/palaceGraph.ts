import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../providers/index.js'
import { AnalyzeAgent } from '../agenthub/analyzeAgent.js'
import { ImageGenAgent } from '../agenthub/imageGenAgent.js'
import { AnchorAgent } from '../agenthub/anchorAgent.js'
import { PalaceSubgraphState } from '../state.js'

// ===== HITL 中断错误 =====

export class HITLInterruptError extends Error {
  constructor(public data: HITLInterruptData) {
    super('HITL_INTERRUPT')
    this.name = 'HITLInterruptError'
  }
}

export interface HITLInterruptData {
  type: 'imageGen_confirmation'
  currentPrompt: string
  palaceTheme: string
  stationCount: number
}

// ===== 配置选项 =====

export interface PalaceSubgraphOptions {
  provider: LLMProvider
  enableHITL?: boolean
}

// ===== Subgraph 构建器 =====

/**
 * 构建 Palace Subgraph
 * 流程: START -> analyze -> [HITL?] -> imageGen -> vision -> END
 */
export function buildPalaceSubgraph(options: PalaceSubgraphOptions) {
  const { provider, enableHITL = false } = options

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
      // 如果用户已确认 prompt，使用确认后的值
      if (state.userConfirmedPrompt) {
        const modifiedState = { ...state, imagePrompt: state.userConfirmedPrompt }
        return imageGen.invoke(modifiedState)
      }
      return imageGen.invoke(state)
    })
    .addNode('vision', (state) => vision.invoke(state))

  // 基础边
  graph.addEdge(START, 'analyze')
  graph.addEdge('imageGen', 'vision')
  graph.addEdge('vision', END)

  // HITL 支持
  if (enableHITL) {
    graph.addNode('hitl_check', async (state) => {
      // 检查是否已经有用户确认的值（从恢复时传入）
      if (state.userConfirmedPrompt) {
        return {
          imagePrompt: state.userConfirmedPrompt,
          interruptPoint: null,
        }
      }

      // 准备中断数据
      const interruptData: HITLInterruptData = {
        type: 'imageGen_confirmation',
        currentPrompt: state.imagePrompt || state.palace?.theme || '',
        palaceTheme: state.palace?.theme || '',
        stationCount: state.palace?.stations.length || 0,
      }

      // 抛出中断错误，被上层捕获并处理
      throw new HITLInterruptError(interruptData)
    })

    ;(graph as unknown as { addEdge: (from: string, to: string) => void }).addEdge('analyze', 'hitl_check')
    graph.addConditionalEdges('hitl_check' as never, (state) => {
      if (state.error) return END
      if (state.userConfirmedPrompt) return 'imageGen'
      return END
    })
  } else {
    graph.addEdge('analyze', 'imageGen')
  }

  return graph
}
