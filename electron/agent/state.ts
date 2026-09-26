import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { Document } from '@langchain/core/documents'
import type { ChatToolCallStep, DocumentRef } from '@/shared/lib/fileFormat'
import type { DocumentSource as MindmapInputSource } from './document/index.js'
import type { DetectedAnchor } from './providers/index.js'
import type { ChatContext, PalaceArtworkStyle } from '../ipc.js'
import type { MindmapOutlineNode } from './utils/mindmapOutline.js'

export type { DocumentRef }
export type { MindmapInputSource }

/**
 * Run entry: which edge the main graph takes out of START.
 *
 * `palace` is the entry of the manual-palace ephemeral run (straight to the
 * palace subgraph, skipping compaction and the supervisor); plain chat runs
 * are always `chat` (the channel default). ADR-0023 lands the conditional
 * edge that reads this marker.
 */
type RunEntry = 'chat' | 'palace'

/** 简单替换型 reducer：直接用新值覆盖旧值。 */
function replaceReducer<T>(_prev: T, next: T): T {
  return next
}

/**
 * 并行分支汇聚型 reducer：分支结果追加到列表尾部;
 * 写 `null` 清空(新一轮归并开始前、以及 run 重置时使用)。
 */
function appendReducer<T>(current: T[], update: T[] | null): T[] {
  return update === null ? [] : [...current, ...update]
}

// ===== 基础类型定义 =====

export type SelectedNodeContent = {
  id: string
  label: string
}

export type MemoryItem = {
  order: number
  content: string
}

export type StationDesign = {
  order: number
  content: string
  anchorVisual: string
  mnemonicMethod: string
  association: string
  linkedNodeId?: string
}

type PalaceDesign = {
  theme: string
  sceneBrief?: string
  routeStyle?: string
  stations: StationDesign[]
}

export type MemoryPalaceStation = {
  order: number
  content: string
  x: number
  y: number
  anchorVisual?: string
  mnemonicMethod?: string
  association?: string
  linkedNodeId?: string
}

type PendingSubgraph = 'mindmap' | 'palace'

// ===== 状态切片定义（用于组合和复用） =====

/**
 * 轮次通道：主图与两个子图共享的输入通道。
 *
 * 两个子图都只**读** context，messages 走 append reducer，两种访问都不会互相覆盖。
 */
const TurnAnnotations = {
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  context: Annotation<ChatContext | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
}

/** 主图独有：监督器自己的答复/错误、滚动摘要与路由判别键。 */
const SupervisorAnnotations = {
  /**
   * Subgraph calls declared this round and still awaiting execution, in
   * declaration order. The supervisor writes it, the conditional edge reads it,
   * subgraph nodes never write it — a leftover value would route the graph back
   * into a subgraph that already ran. A list rather than a single value because
   * one round can declare several.
   */
  pendingSubgraphs: Annotation<PendingSubgraph[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  response: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  error: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  /**
   * 滚动摘要（running summary）：由 contextCompact 节点从会话 meta 的
   * `_lastSummary` 读入，supervisor 构建 system prompt 时经
   * `ContextBuilder.withLastSummary` 注入 `## 历史摘要` 段。
   * 非压缩路径（I/O 失败降级）下为空字符串。
   */
  summary: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
}

/**
 * 子图自有标量通道：每个子图各一套，键名带子图前缀。
 *
 * 这些通道必须按子图拆名：它们都带替换型 reducer，两个子图在同一超步里写同一个键
 * 会**静默**后写覆盖（只有不带 reducer 的通道才会响亮报错）。调用信息（调用 id、
 * 工具名）同理每图一份，收口时不必猜是哪个子图发起的。
 *
 * 两个虚拟工具的 schema 都是空对象，所以没有「调用输入」可留；等 schema 有了参数再加。
 */
const MindmapScalarAnnotations = {
  mindmapError: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  mindmapResponse: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  mindmapToolCallId: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  mindmapToolName: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
}

const PalaceScalarAnnotations = {
  /** 子图阶段轨迹（与 step 流事件同源），由子图收口并随子图状态返回主图。 */
  palaceToolSteps: Annotation<ChatToolCallStep[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  palaceError: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  palaceResponse: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  /**
   * 落图应答器的结果（空 = 成功）：宫殿生成成功但写动作失败时，子图收口把它写进
   * ToolMessage 与运行 `end` 载荷，渲染层据此把占位节点标成待继续。
   */
  palaceLandingError: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  palaceToolCallId: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  palaceToolName: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
}

/**
 * Run-level entry channel: main graph only (subgraphs never read the entry).
 * The START conditional edge consumes it; until that edge lands, every run
 * still traverses compaction and the supervisor.
 */
const RunAnnotations = {
  runEntry: Annotation<RunEntry>({
    reducer: replaceReducer,
    default: () => 'chat',
  }),
}

/**
 * 记忆宫殿状态切片（私有键：只此一图写，主图照走合并）
 */
const PalaceStateAnnotations = {
  artworkStyle: Annotation<PalaceArtworkStyle>({
    reducer: replaceReducer,
    default: () => 'vector',
  }),
  palaceInputText: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  palaceInputNodes: Annotation<SelectedNodeContent[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  memoryItems: Annotation<MemoryItem[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  palace: Annotation<PalaceDesign | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  imagePrompt: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  imageUrls: Annotation<string[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  imageError: Annotation<string | undefined>({
    reducer: replaceReducer,
    default: () => undefined,
  }),
  detectedCoords: Annotation<DetectedAnchor[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  memoryRoute: Annotation<MemoryPalaceStation[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
}

/**
 * 思维导图状态切片
 *
 * 波浪式并发（ADR-0008）:
 * - `batchIndex` / `mergeGroup` 是 Send 分支的输入载体,每个分支只读自己的那份。
 * - `leafResults` / `mergeResults` 用 append reducer 汇聚并行分支结果;
 *   写 `null` 可清空(新一轮归并开始前、以及 run 重置时使用)。
 * - `mergeInputs` 语义收窄为「当前归并轮次的输入树列表」,由 start_merge_round
 *   节点写入,供波式路由跨 super-step 稳定读取。
 */
const MindmapStateAnnotations = {
  mindmapInputSource: Annotation<MindmapInputSource | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  mindmapInputTitle: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  documentBatches: Annotation<Document[][]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  batchIndex: Annotation<number>({
    reducer: replaceReducer,
    default: () => -1,
  }),
  leafResults: Annotation<
    Array<{ batchIndex: number; batchId: string; tree: MindmapOutlineNode }>,
    Array<{ batchIndex: number; batchId: string; tree: MindmapOutlineNode }> | null
  >({
    reducer: appendReducer,
    default: () => [],
  }),
  mergeInputs: Annotation<MindmapOutlineNode[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  mergeGroup: Annotation<{
    groupIndex: number
    groupCount: number
    trees: MindmapOutlineNode[]
  } | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  mergeResults: Annotation<
    Array<{ groupIndex: number; tree: MindmapOutlineNode }>,
    Array<{ groupIndex: number; tree: MindmapOutlineNode }> | null
  >({
    reducer: appendReducer,
    default: () => [],
  }),
  finalTree: Annotation<MindmapOutlineNode | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  documentRef: Annotation<DocumentRef | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
}

// ===== 组合状态定义 =====

/**
 * 主图状态 - MindLaneAgent 使用
 *
 * 逐片展开（而不是挑几个键）是刻意的：子图写而主图未声明的键会被**静默丢弃**，
 * 所以这里必须是两个子图通道的并集，新增子图键只能改这里一处。
 */
export const MainGraphState = Annotation.Root({
  ...RunAnnotations,
  ...TurnAnnotations,
  ...SupervisorAnnotations,
  ...MindmapScalarAnnotations,
  ...PalaceScalarAnnotations,
  ...MindmapStateAnnotations,
  ...PalaceStateAnnotations,
})

/**
 * Palace 子图专用状态
 * 包含：轮次通道 + Palace 标量通道 + Palace 完整状态
 */
export const PalaceSubgraphState = Annotation.Root({
  ...TurnAnnotations,
  ...PalaceScalarAnnotations,
  ...PalaceStateAnnotations,
})

/**
 * 思维导图子图专用状态
 * 包含：轮次通道 + 思维导图标量通道 + 思维导图状态
 */
export const MindmapSubgraphState = Annotation.Root({
  ...TurnAnnotations,
  ...MindmapScalarAnnotations,
  ...MindmapStateAnnotations,
})

// ===== 类型导出 =====

export type MainGraphStateType = typeof MainGraphState.State
export type PalaceSubgraphStateType = typeof PalaceSubgraphState.State
export type MindmapSubgraphStateType = typeof MindmapSubgraphState.State
