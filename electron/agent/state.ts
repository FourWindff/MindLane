import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { DetectedAnchor } from './providers/index.js'
import type { MindmapContextData } from './tools/mindmapContext.js'

/** 简单替换型 reducer：直接用新值覆盖旧值。 */
function replaceReducer<T>(_prev: T, next: T): T {
  return next
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

export interface MindmapInputSource {
  type: 'pdf' | 'url' | 'text'
  path?: string
  url?: string
  content?: string
}

export interface DocumentRef {
  id: string
  type: 'pdf' | 'url' | 'text'
  source: string
  filename: string
  importedAt: string
  title?: string
  pageCount?: number
  /** 解析后的完整文本在 userdata 下的缓存路径（相对路径） */
  textPath?: string
  metadata: {
    sha256: string
    originalPath?: string
    textCacheKey?: string
    size?: number
    mtimeMs?: number
    textCachedAt?: string
    [key: string]: unknown
  }
}

export type DocumentChunk = {
  id: string
  index: number
  startPage: number
  endPage: number
  text: string
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
  context: Annotation<MindmapContextData | null>({
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
  documentChunks: Annotation<DocumentChunk[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  leafCursor: Annotation<number>({
    reducer: replaceReducer,
    default: () => 0,
  }),
  pendingLeafRange: Annotation<{ start: number; end: number } | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  leafResults: Annotation<Array<{ chunkIndex: number; chunkId: string; tree: unknown }>>({
    reducer: replaceReducer,
    default: () => [],
  }),
  mergeInputs: Annotation<unknown[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  partialMergedTrees: Annotation<unknown[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  mergeResults: Annotation<Array<{ groupIndex: number; tree: unknown }>>({
    reducer: replaceReducer,
    default: () => [],
  }),
  pendingMergeGroups: Annotation<Array<{ groupIndex: number; trees: unknown[] }>>({
    reducer: replaceReducer,
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
