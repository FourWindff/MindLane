import { Annotation } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { DetectedAnchor } from './providers/index.js'
import type { MindmapContextData } from './tools/mindmapContext.js'

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

export type PalaceDesign = {
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

export type GeneratedNode = {
  id: string
  type: 'text'
  data: Record<string, unknown>
}

export type GeneratedEdge = {
  id: string
  source: string
  target: string
  type: string
}

// ===== 状态切片定义（用于组合和复用） =====

/**
 * 基础状态切片 - 所有图共享的状态
 */
export const BaseStateAnnotations = {
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  context: Annotation<MindmapContextData | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  intent: Annotation<'qa' | 'palace' | 'mindmap'>({
    reducer: (_prev, next) => next,
    default: () => 'qa',
  }),
  response: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  error: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
}

/**
 * 记忆宫殿状态切片
 */
export const PalaceStateAnnotations = {
  palaceInputText: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  palaceInputNodes: Annotation<SelectedNodeContent[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  memoryItems: Annotation<MemoryItem[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  palace: Annotation<PalaceDesign | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  imagePrompt: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  imageUrls: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  imageError: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  detectedCoords: Annotation<DetectedAnchor[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  memoryRoute: Annotation<MemoryPalaceStation[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
}

/**
 * 思维导图状态切片
 */
export const MindmapStateAnnotations = {
  mindmapInputText: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  mindmapInputTitle: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  mindmapNodes: Annotation<GeneratedNode[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  mindmapEdges: Annotation<GeneratedEdge[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  mindmapTitle: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
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
