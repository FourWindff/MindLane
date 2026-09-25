import { StateGraph, START, END, getWriter } from '@langchain/langgraph'
import type { LLMProvider } from '../providers/index.js'
import { AnalyzeAgent } from '../agenthub/analyzeAgent.js'
import { ImageGenAgent } from '../agenthub/imageGenAgent.js'
import { AnchorAgent } from '../agenthub/anchorAgent.js'
import { SvgAgent } from '../agenthub/svgAgent.js'
import {
  PalaceSubgraphState,
  type MemoryPalaceStation,
  type PalaceSubgraphStateType,
} from '../state.js'
import { logger } from '../../shared/logger.js'
import { currentStreamId, requireStreamId } from '../../shared/runContext.js'
import { takeModelCallCount } from '../providers/metering.js'
import {
  SUBGRAPH_PROGRESS_EVENT,
  type PalaceRunPayload,
  type SubgraphProgressStep,
} from '../../ipc.js'
import type { ChatToolCallStep } from '../../../src/shared/lib/fileFormat.js'

import { PalaceInputResolver } from './palaceGraph/inputResolver.js'
import { normalizePalaceImageUrls } from './palaceGraph/normalizeImageUrls.js'
import { resolveArtworkStyle } from '../../../src/shared/lib/palaceArtworkStyle.js'
import { buildSubgraphToolMessage } from '../subgraphRouter.js'

const log = logger.withContext('palace')

/** Per-run start times keyed by streamId for the closing summary line. */
const runStarts = new Map<string, number>()

/** Run key for the per-stream bookkeeping maps (see `requireStreamId`). */
function runKey(): string {
  return requireStreamId('记忆宫殿子图')
}

// ===== 配置选项 =====

interface PalaceSubgraphOptions {
  provider: LLMProvider
}

// ===== Subgraph 构建器 =====

/**
 * Emit one stage and return the trace to carry in state: the live card reads
 * the custom event, the persisted ToolMessage reads state.palaceToolSteps. Emitting
 * at node entry is the point — the running card must show the stage while the
 * node is still working, not when it finishes.
 */
function beginStage(
  state: Pick<PalaceSubgraphStateType, 'palaceToolSteps' | 'palaceToolCallId'>,
  step: SubgraphProgressStep,
): ChatToolCallStep[] {
  getWriter()?.({ type: SUBGRAPH_PROGRESS_EVENT, step, callId: state.palaceToolCallId })
  return [...(state.palaceToolSteps ?? []), { step }]
}

/**
 * The palace subgraph's output payload — one builder for the close-out
 * ToolMessage and for the run's `end` event, so the two shapes cannot drift.
 */
export function buildPalacePayload(state: {
  palaceError: string
  palaceResponse: string
  palace: { theme: string } | null
  memoryRoute: MemoryPalaceStation[]
  imageUrls: string[]
  palaceInputNodes: { id: string }[]
}): PalaceRunPayload {
  if (state.palaceError) {
    return { ok: false, error: state.palaceResponse || state.palaceError }
  }

  return {
    ok: true,
    label: state.palace?.theme || `记忆宫殿 (${state.memoryRoute.length} 站)`,
    stations: state.memoryRoute.map((s) => ({
      order: s.order,
      content: s.content,
      anchorVisual: s.anchorVisual ?? '',
      association: s.association,
      x: s.x,
      y: s.y,
      linkedNodeId: s.linkedNodeId ?? '',
    })),
    // The palace subgraph normalizes remote URLs to data URLs inside the
    // graph, so the first entry is already the persistable payload.
    imageUrl: state.imageUrls[0] ?? '',
    sourceNodeIds: state.palaceInputNodes.map((n) => n.id),
  }
}

/**
 * Close out the run: this node owns the subgraph's ToolMessage (call id, tool
 * name, stage trace). The host graph mounts this subgraph as a node, so the
 * ToolMessage lands in the main graph's messages channel directly.
 */
function buildOutputNode(state: PalaceSubgraphStateType): Partial<PalaceSubgraphStateType> {
  const content = buildPalacePayload(state)
  const toolSteps = state.palaceToolSteps ?? []
  return {
    messages: [
      buildSubgraphToolMessage({
        subgraph: 'palace',
        toolCallId: state.palaceToolCallId,
        toolName: state.palaceToolName,
        payload: content,
        toolSteps,
      }),
    ],
  }
}

/**
 * 构建 Palace Subgraph
 * 流程: START -> resolve_input -> analyze -> (svgGen | imageGen -> normalizeImages -> vision) -> build_output -> END
 *
 * Compiled without a checkpointer and without its own stream: the host graph
 * owns persistence and the run context (this graph is mounted as its node).
 */
export function buildPalaceSubgraph(options: PalaceSubgraphOptions) {
  const { provider } = options

  const analyze = new AnalyzeAgent(provider)
  const imageGen = new ImageGenAgent(provider)
  const vision = new AnchorAgent(provider)
  const svgGen = new SvgAgent(provider)
  const inputResolver = new PalaceInputResolver()

  // 使用 Palace 子图专用状态类型
  const graph = new StateGraph(PalaceSubgraphState)
    .addNode('resolve_input', async (state) => {
      const resolution = await inputResolver.resolve(state)
      if (!resolution) {
        return {
          palaceError: '请提供记忆宫殿的输入内容。',
          palaceResponse: '请提供记忆宫殿的输入内容。',
          // Clear the trace carried in from the main graph: a previous subgraph run
          // must not leak its stages into this one's ToolMessage.
          palaceToolSteps: [],
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
        // 新一轮开始：上一轮（或上一张子图）的答复与错误不得残留成本轮的收口依据。
        palaceError: '',
        palaceResponse: '',
        palaceToolSteps: [],
      }
    })
    .addNode('analyze', async (state) => {
      const toolSteps = beginStage(state, 'planning-stations')
      const start = Date.now()
      const result = await analyze.invoke(state)
      const stations = (result as { palace?: { stations?: unknown[] } }).palace?.stations
      log.info(
        'analyze 完成： %d 站, %ss',
        stations?.length ?? 0,
        ((Date.now() - start) / 1000).toFixed(1),
      )
      return { ...result, palaceToolSteps: toolSteps }
    })
    .addNode('svgGen', async (state) => {
      const toolSteps = beginStage(state, 'generating-image')
      const start = Date.now()
      const result = await svgGen.invoke(state)
      runStarts.delete(runKey())
      log.info(
        'svgGen 完成： 画面%s, %ss',
        result.imageUrls?.length ? '可用' : '缺失',
        ((Date.now() - start) / 1000).toFixed(1),
      )
      return { ...result, palaceToolSteps: toolSteps }
    })
    .addNode('imageGen', async (state) => {
      const toolSteps = beginStage(state, 'generating-image')
      const start = Date.now()
      const result = await imageGen.invoke(state)
      const urls = (result as { imageUrls?: string[] }).imageUrls
      const imageError = (result as { imageError?: string }).imageError
      if (imageError) log.warn('imageGen 失败： %s', imageError)
      else
        log.info(
          'imageGen 完成： 生成 %d 张图, %ss',
          urls?.length ?? 0,
          ((Date.now() - start) / 1000).toFixed(1),
        )
      return { ...result, palaceToolSteps: toolSteps }
    })
    .addNode('normalizeImages', (state) => normalizePalaceImageUrls(state))
    .addNode('vision', async (state) => {
      const toolSteps = beginStage(state, 'locating-stations')
      const start = Date.now()
      const result = await vision.invoke(state)
      const route = (result as { memoryRoute?: unknown[] }).memoryRoute
      log.info(
        'vision 完成： 定位 %d 站, %ss',
        route?.length ?? 0,
        ((Date.now() - start) / 1000).toFixed(1),
      )

      const key = runKey()
      const runStart = runStarts.get(key)
      runStarts.delete(key)
      log.info(
        '完成： 总耗时 %ss, 产出 %d 站, 模型调用 %d 次',
        runStart ? ((Date.now() - runStart) / 1000).toFixed(1) : '0',
        route?.length ?? 0,
        takeModelCallCount(currentStreamId() ?? ''),
      )
      return { ...result, palaceToolSteps: toolSteps }
    })
    .addNode('build_output', buildOutputNode)

  // 基础边
  graph.addEdge(START, 'resolve_input')
  graph.addConditionalEdges(
    'resolve_input',
    (state) => (state.palaceError ? 'build_output' : 'analyze'),
    ['analyze', 'build_output'],
  )
  graph.addConditionalEdges(
    'analyze',
    (state) => resolveArtworkStyle(state.artworkStyle, provider.capabilities),
    { vector: 'svgGen', raster: 'imageGen' },
  )
  graph.addEdge('svgGen', 'build_output')
  graph.addEdge('imageGen', 'normalizeImages')
  graph.addEdge('normalizeImages', 'vision')
  graph.addEdge('vision', 'build_output')
  graph.addEdge('build_output', END)

  return graph
}
