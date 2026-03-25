export interface MindLaneFile {
  version: '1.0'
  metadata: {
    title: string
    createdAt: string
    updatedAt: string
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
  | { id: string; type: 'topic'; position: XY; data: TopicNodeData }
  | { id: string; type: 'palace'; position: XY; data: PalaceNodeData }
  | { id: string; type: 'document'; position: XY; data: DocumentNodeData }

export interface XY {
  x: number
  y: number
}

export type TopicNodeData = {
  label: string
  palaceId?: string
  justAdded?: boolean
  exiting?: boolean
  [key: string]: unknown
}

export type PalaceNodeData = {
  label: string
  imageUrl: string
  stations: PalaceStation[]
  sourceNodeIds: string[]
  [key: string]: unknown
}

export type PalaceStation = {
  order: number
  content: string
  anchorVisual: string
  association?: string
  x: number
  y: number
  linkedNodeId: string
}

export type DocumentNodeData = {
  filename: string
  excerpt: string
  fullTextPath?: string
  [key: string]: unknown
}

export interface DocumentRef {
  id: string
  filename: string
  importedAt: string
  textPath: string
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
          type: 'topic',
          position: { x: 0, y: 0 },
          data: { label: '中心主题' },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    documents: [],
  }
}

export function serializeFile(file: MindLaneFile): string {
  return JSON.stringify(
    { ...file, metadata: { ...file.metadata, updatedAt: new Date().toISOString() } },
    null,
    2,
  )
}
