import type { PalaceNodeData, TextNodeData, ImageNodeData } from './nodeData.js'
import type { MindmapStyleState } from './mindmapStyle.js'

export type { PalaceNodeData, PalaceStation } from './nodeData.js'
export type { MindLaneAsset } from './mindmapXml/types.js'
import type { MindLaneAsset } from './mindmapXml/types.js'

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

export function isDefaultViewport(vp: { x: number; y: number; zoom: number }): boolean {
  return (
    vp.x === DEFAULT_VIEWPORT.x && vp.y === DEFAULT_VIEWPORT.y && vp.zoom === DEFAULT_VIEWPORT.zoom
  )
}

export interface MindLaneFile {
  version: '1.0'
  metadata: {
    fileUuid: string
    title: string
    createdAt: string
    updatedAt: string
  }
  mindmap: {
    nodes: MindLaneNode[]
    edges: MindLaneEdge[]
    viewport: { x: number; y: number; zoom: number }
    /** Per-file style; older files may lack it, and loading falls back to the default style */
    style?: MindmapStyleState
  }
  /** Embedded image assets (XML assets section); nodes reference them via the asset attribute, deduped by sha256 */
  assets: MindLaneAsset[]
  documents: DocumentRef[]
}

interface MindLaneEdge {
  id: string
  source: string
  target: string
  type?: string
  className?: string
}

export type MindLaneNode =
  | { id: string; type: 'text'; position: XY; data: TextNodeData }
  | { id: string; type: 'palace'; position: XY; data: PalaceNodeData }
  | { id: string; type: 'image'; position: XY; data: ImageNodeData }

interface XY {
  x: number
  y: number
}

export interface DocumentRef {
  id: string
  type: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'markdown' | 'url' | 'text'
  source: string
  filename: string
  importedAt: string
  title?: string
  pageCount?: number
  /** Cache path (relative) of the parsed full text under userdata */
  textPath?: string
  /** Document content hash, used for cache hits and deduplication */
  sha256?: string
}

/** One subgraph stage: step name + optional progress counts (same source as `step` stream events). */
export interface ChatToolCallStep {
  step: string
  completed?: number
  total?: number
}

export interface ChatToolCall {
  name: string
  args: Record<string, unknown>
  result: string
  /** Optional: tool result status (persisted with history). `running`/`success`/`error` are inferred from the tool result; `canceled` marks a tool left unfinished by a stop. Old sessions legitimately lack it. */
  status?: 'running' | 'success' | 'error' | 'canceled'
  /** Optional: subgraph stage trace (subgraph tools only). Old sessions legitimately lack it. */
  steps?: ChatToolCallStep[]
}

interface ChatMessageAttachment {
  name: string
  type: DocumentRef['type']
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ChatToolCall[]
  attachment?: ChatMessageAttachment
  timestamp?: string
}

export function isTextNodeData(data: unknown): data is TextNodeData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'label' in data &&
    typeof (data as Record<string, unknown>).label === 'string'
  )
}

export function isPalaceNodeData(data: unknown): data is PalaceNodeData {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  return (
    typeof record.label === 'string' &&
    typeof record.imageUrl === 'string' &&
    Array.isArray(record.stations) &&
    Array.isArray(record.sourceNodeIds)
  )
}

export function createEmptyFile(title = 'Untitled'): MindLaneFile {
  const now = new Date().toISOString()
  return {
    version: '1.0',
    metadata: { fileUuid: crypto.randomUUID(), title, createdAt: now, updatedAt: now },
    mindmap: {
      nodes: [
        {
          id: 'root',
          type: 'text',
          position: { x: 0, y: 0 },
          data: { label: 'Central Topic' },
        },
      ],
      edges: [],
      viewport: DEFAULT_VIEWPORT,
    },
    assets: [],
    documents: [],
  }
}
