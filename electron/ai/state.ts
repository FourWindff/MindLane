import { Annotation } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { DetectedAnchor } from './providers/index.js'
import type { MindmapContextData } from './agents/tools/mindmapContext.js'

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
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export type GeneratedEdge = {
  id: string
  source: string
  target: string
  type: string
}

export const AgentState = Annotation.Root({
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

  palaceInputText: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  palaceInputNodes: Annotation<SelectedNodeContent[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  mindmapInputText: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  mindmapInputTitle: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
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

  response: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  error: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
})
