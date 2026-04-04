import { Annotation } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { DetectedAnchor } from './providers/index.js'
import type { MindmapContextData } from './agents/tools/mindmapContext.js'

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
  type: 'topic' | 'document'
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

/**
 * HITL (Human-in-the-Loop) 状态扩展
 */
export const HITLStateAnnotations = {
  interruptPoint: Annotation<'imageGen' | 'mindmapGen' | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  userConfirmedPrompt: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  userConfirmedStructure: Annotation<{
    nodes: GeneratedNode[]
    edges: GeneratedEdge[]
    title: string
  } | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
}

// ===== 组合状态定义 =====

/**
 * 主图状态 - 包含所有状态切片
 * 用于向后兼容
 */
export const AgentState = Annotation.Root({
  ...BaseStateAnnotations,
  ...PalaceStateAnnotations,
  ...MindmapStateAnnotations,
})

/**
 * 带 HITL 支持的完整状态
 */
export const AgentStateWithHITL = Annotation.Root({
  ...BaseStateAnnotations,
  ...PalaceStateAnnotations,
  ...MindmapStateAnnotations,
  ...HITLStateAnnotations,
})

// ===== 类型导出（便于类型注解） =====

export type BaseState = typeof BaseStateAnnotations
export type PalaceState = typeof PalaceStateAnnotations
export type MindmapState = typeof MindmapStateAnnotations
export type HITLState = typeof HITLStateAnnotations
export type AgentStateType = typeof AgentState.State
export type AgentStateWithHITLType = typeof AgentStateWithHITL.State
