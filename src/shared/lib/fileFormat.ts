import type { PalaceNodeData } from '@/features/mindmap/nodes/palace/types'
import type { TextNodeData } from '@/features/mindmap/nodes/text/types'

export type { PalaceNodeData, PalaceStation } from '@/features/mindmap/nodes/palace/types'

export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

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

interface XY {
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
  /** 解析后的完整文本在 userdata 下的缓存路径（相对路径） */
  textPath?: string
  /** 文档内容哈希，用于缓存命中与去重 */
  sha256?: string
}

/** 将旧版带 metadata 的 DocumentRef 迁移为新版扁平结构。 */
export function migrateDocumentRef(doc: unknown): DocumentRef {
  if (typeof doc !== 'object' || doc === null) {
    throw new Error('Invalid DocumentRef: expected object')
  }
  const record = doc as Record<string, unknown>
  const metadata = (record.metadata as Record<string, unknown> | undefined) ?? {}

  return {
    id: String(record.id ?? ''),
    type: String(record.type ?? 'text') as DocumentRef['type'],
    source: String(record.source ?? ''),
    filename: String(record.filename ?? ''),
    importedAt: String(record.importedAt ?? new Date().toISOString()),
    title: typeof record.title === 'string' ? record.title : undefined,
    pageCount: typeof record.pageCount === 'number' ? record.pageCount : undefined,
    textPath: typeof record.textPath === 'string' ? record.textPath : undefined,
    sha256:
      typeof record.sha256 === 'string'
        ? record.sha256
        : typeof metadata.sha256 === 'string'
          ? metadata.sha256
          : undefined,
  }
}

export interface ChatToolCall {
  name: string
  args: Record<string, unknown>
  result: string
}

interface ChatMessageAttachment {
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
    metadata: { fileUuid: crypto.randomUUID(), title, createdAt: now, updatedAt: now },
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
