import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { Document } from '@langchain/core/documents'
import type { DocumentRef } from '@/shared/lib/fileFormat'
import type { DocumentSource as MindmapInputSource } from './document/index.js'
import type { DetectedAnchor } from './providers/index.js'
import type { ChatContext } from '../ipc.js'

export type { DocumentRef }
export type { MindmapInputSource }

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
 * 基础状态切片 - 所有图共享的状态
 */
const BaseStateAnnotations = {
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  context: Annotation<ChatContext | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  pendingSubgraph: Annotation<PendingSubgraph | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  pendingSubgraphToolCallId: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  pendingSubgraphToolName: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  response: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  error: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
}

/**
 * 记忆宫殿状态切片
 */
const PalaceStateAnnotations = {
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
  mindmapYaml: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  mindmapTitle: Annotation<string>({
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
    Array<{ batchIndex: number; batchId: string; tree: unknown }>,
    Array<{ batchIndex: number; batchId: string; tree: unknown }> | null
  >({
    reducer: appendReducer,
    default: () => [],
  }),
  mergeInputs: Annotation<unknown[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  mergeGroup: Annotation<{ groupIndex: number; groupCount: number; trees: unknown[] } | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  mergeResults: Annotation<
    Array<{ groupIndex: number; tree: unknown }>,
    Array<{ groupIndex: number; tree: unknown }> | null
  >({
    reducer: appendReducer,
    default: () => [],
  }),
  finalTree: Annotation<unknown | null>({
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
 * 包含：基础状态 + 思维导图状态 + Palace输入 + Palace输出
 */
export const MainGraphState = Annotation.Root({
  ...BaseStateAnnotations,
  ...MindmapStateAnnotations,
  palaceInputText: PalaceStateAnnotations.palaceInputText,
  palaceInputNodes: PalaceStateAnnotations.palaceInputNodes,
  // Palace 子图输出（需要同步回主图用于构建响应）
  palace: PalaceStateAnnotations.palace,
  imageUrls: PalaceStateAnnotations.imageUrls,
  memoryRoute: PalaceStateAnnotations.memoryRoute,
})

/**
 * Palace 子图专用状态
 * 包含：基础状态 + Palace 完整状态
 */
export const PalaceSubgraphState = Annotation.Root({
  ...BaseStateAnnotations,
  ...PalaceStateAnnotations,
})

/**
 * 思维导图子图专用状态
 * 包含：基础状态 + 思维导图状态
 */
export const MindmapSubgraphState = Annotation.Root({
  ...BaseStateAnnotations,
  ...MindmapStateAnnotations,
})

// ===== 类型导出 =====

export type MainGraphStateType = typeof MainGraphState.State
export type PalaceSubgraphStateType = typeof PalaceSubgraphState.State
export type MindmapSubgraphStateType = typeof MindmapSubgraphState.State
