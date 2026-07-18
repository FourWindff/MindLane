import { StateGraph, START, END } from '@langchain/langgraph'
import type { LLMProvider } from '../providers/index.js'
import { AnalyzeAgent } from '../agenthub/analyzeAgent.js'
import { ImageGenAgent } from '../agenthub/imageGenAgent.js'
import { AnchorAgent } from '../agenthub/anchorAgent.js'
import { PalaceSubgraphState } from '../state.js'
import { logger } from '../../shared/logger.js'
import { currentStreamId } from '../../shared/runContext.js'
import { takeModelCallCount } from '../providers/metering.js'

import { PalaceInputResolver } from './palaceGraph/inputResolver.js'
import { normalizePalaceImageUrls } from './palaceGraph/normalizeImageUrls.js'

const log = logger.withContext('palace')

/** Per-run start times keyed by streamId for the closing summary line. */
const runStarts = new Map<string, number>()

function runKey(): string {
  return currentStreamId() ?? '(no-stream)'
}

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
      runStarts.set(runKey(), Date.now())
      log.info(
        '入口： nodes=%d, text=%d 字符',
        resolution.palaceInputNodes.length,
        resolution.palaceInputText.length,
      )
      return {
        palaceInputNodes: resolution.palaceInputNodes,
        palaceInputText: resolution.palaceInputText,
      }
    })
    .addNode('analyze', async (state) => {
      const start = Date.now()
      const result = await analyze.invoke(state)
      const stations = (result as { palace?: { stations?: unknown[] } }).palace?.stations
      log.info('analyze 完成： %d 站, %.1fs', stations?.length ?? 0, (Date.now() - start) / 1000)
      return result
    })
    .addNode('imageGen', async (state) => {
      const start = Date.now()
      const result = await imageGen.invoke(state)
      const urls = (result as { imageUrls?: string[] }).imageUrls
      const imageError = (result as { imageError?: string }).imageError
      if (imageError) log.warn('imageGen 失败： %s', imageError)
      else
        log.info(
          'imageGen 完成： 生成 %d 张图, %.1fs',
          urls?.length ?? 0,
          (Date.now() - start) / 1000,
        )
      return result
    })
    .addNode('normalizeImages', (state) => normalizePalaceImageUrls(state))
    .addNode('vision', async (state) => {
      const start = Date.now()
      const result = await vision.invoke(state)
      const route = (result as { memoryRoute?: unknown[] }).memoryRoute
      log.info('vision 完成： 定位 %d 站, %.1fs', route?.length ?? 0, (Date.now() - start) / 1000)

      const key = runKey()
      const runStart = runStarts.get(key)
      runStarts.delete(key)
      log.info(
        '完成： 总耗时 %.1fs, 产出 %d 站, 模型调用 %d 次',
        runStart ? (Date.now() - runStart) / 1000 : 0,
        route?.length ?? 0,
        takeModelCallCount(currentStreamId() ?? ''),
      )
      return result
    })

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
