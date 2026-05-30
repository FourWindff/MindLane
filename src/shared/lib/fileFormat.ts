import { PalaceNodeData } from "@/features/mindmap/nodes/palace"
import { TextNodeData } from "@/features/mindmap/nodes/text"

export type { PalaceNodeData, PalaceStation } from "@/features/mindmap/nodes/palace"
export type { TextNodeData }


export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

export function isDefaultViewport(vp: { x: number; y: number; zoom: number }): boolean {
  return vp.x === DEFAULT_VIEWPORT.x && vp.y === DEFAULT_VIEWPORT.y && vp.zoom === DEFAULT_VIEWPORT.zoom
}

export interface MindLaneFile {
  version: '1.0'
  metadata: {
    title: string
    createdAt: string
    updatedAt: string
    tags?: string[]
  }
  mindmap: {
    nodes: MindLaneNode[]
    edges: MindLaneEdge[]
    viewport: { x: number; y: number; zoom: number }
  }
  documents: DocumentRef[]
}

export interface MindLaneEdge {
  id: string
  source: string
  target: string
  type?: string
  className?: string
}

export type MindLaneNode =
  | { id: string; type: 'text'; position: XY; data: TextNodeData }
  | { id: string; type: 'palace'; position: XY; data: PalaceNodeData }

export interface XY {
  x: number
  y: number
}


export interface DocumentRef {
  id: string
  type: 'pdf' | 'url' | 'text'
  source: string
  filename: string
  importedAt: string
  title?: string
  pageCount?: number
  metadata?: {
    originalPath?: string
    textCacheKey?: string
    size?: number
    mtimeMs?: number
    sha256?: string
    textCachedAt?: string
    [key: string]: unknown
  }
}

export interface ChatToolCall {
  name: string
  args: Record<string, unknown>
  result: string
}

export interface ChatMessageAttachment {
  name: string
  type: 'pdf' | 'url' | 'text'
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

export function createEmptyFile(title = '未命名'): MindLaneFile {
  const now = new Date().toISOString()
  return {
    version: '1.0',
    metadata: { title, createdAt: now, updatedAt: now },
    mindmap: {
      nodes: [
        {
          id: 'root',
          type: 'text',
          position: { x: 0, y: 0 },
          data: { label: '中心主题' },
        },
      ],
      edges: [],
      viewport: DEFAULT_VIEWPORT,
    },
    documents: [],
  }
}
