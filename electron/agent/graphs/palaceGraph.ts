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
import { serializePalaceNodeXml } from '../../../src/shared/lib/mindmapXml/index.js'
import type { MindmapWriteProxy } from '../tools/mindmapActions.js'

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
  /**
   * 落盘代理（主进程 → 渲染层落图应答器）：宫殿 payload 由代码序列化为 XML，
   * 经新增的 `landPalace` 写动作落图。手动运行与 AI 触发都经这里，形状一致。
   */
  writeProxy?: MindmapWriteProxy
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
  palaceLandingError: string
  palace: { theme: string } | null
  memoryRoute: MemoryPalaceStation[]
  imageUrls: string[]
  palaceInputNodes: { id: string }[]
}): PalaceRunPayload {
  if (state.palaceError) {
    return { ok: false, error: state.palaceResponse || state.palaceError }
  }
  if (state.palaceLandingError) {
    return { ok: false, error: landingFailureText(state.palaceLandingError) }
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

/** One wording for a generated-but-unlanded palace (ToolMessage and the run's end payload). */
function landingFailureText(error: string): string {
  return `宫殿已生成，但落图失败：${error}`
}

/**
 * 落图：把成功 payload 序列化为 XML，经 `landPalace` 写动作落到渲染层。
 * 返回错误文案（空串 = 成功）；缺代理即视为落图失败，不静默跳过。
 */
async function requestPalaceLanding(
  writeProxy: MindmapWriteProxy | undefined,
  fileUuid: string,
  payload: PalaceRunPayload & { ok: true },
): Promise<string> {
  if (!writeProxy) return '落盘通道不可用'
  try {
    const ack = (await writeProxy(fileUuid, 'landPalace', {
      xml: serializePalaceNodeXml(payload),
    })) as { ok?: unknown; error?: unknown } | undefined
    if (ack?.ok === false) {
      return typeof ack.error === 'string' ? ack.error : '落图请求被拒绝'
    }
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * The ToolMessage reads what the model needs: a landed palace, not the artwork.
 * The data URL stays out of the model context — the write request carries it.
 */
function toModelPalacePayload(payload: PalaceRunPayload): Record<string, unknown> {
  if (!payload.ok) return payload
  return {
    ok: true,
    landed: true,
    label: payload.label,
    stations: payload.stations,
    sourceNodeIds: payload.sourceNodeIds,
  }
}

/**
 * Close out the run: this node owns the subgraph's ToolMessage (call id, tool
 * name, stage trace) and performs the deterministic landing (both trigger
 * surfaces run through here). The host graph mounts this subgraph as a node, so
 * the ToolMessage lands in the main graph's messages channel directly.
 */
async function buildOutputNode(
  state: PalaceSubgraphStateType,
  writeProxy: MindmapWriteProxy | undefined,
): Promise<Partial<PalaceSubgraphStateType>> {
  // A previous run's landing outcome must not decide this run's payload: rebuild
  // the generated payload with the landing key cleared, then land for real.
  const generated = buildPalacePayload({ ...state, palaceLandingError: '' })
  const landingError = generated.ok
    ? await requestPalaceLanding(writeProxy, state.context?.fileUuid ?? '', generated)
    : ''
  const payload = landingError
    ? ({ ok: false, error: landingFailureText(landingError) } as const)
    : generated
  return {
    messages: [
      buildSubgraphToolMessage({
        subgraph: 'palace',
        toolCallId: state.palaceToolCallId,
        toolName: state.palaceToolName,
        payload: toModelPalacePayload(payload),
        toolSteps: state.palaceToolSteps ?? [],
      }),
    ],
    palaceLandingError: landingError,
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
  const { provider, writeProxy } = options

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
        palaceLandingError: '',
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
    .addNode('build_output', (state: PalaceSubgraphStateType) => buildOutputNode(state, writeProxy))

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
