import { PalaceNodeData } from "@/features/mindmap/nodes/palace"
import { TextNodeData } from "@/features/mindmap/nodes/text"

export type { PalaceNodeData, PalaceStation } from "@/features/mindmap/nodes/palace"
export type { TextNodeData }


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
  | { id: string; type: 'text'; position: XY; data: TextNodeData }
  | { id: string; type: 'palace'; position: XY; data: PalaceNodeData }

export interface XY {
  x: number
  y: number
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
          type: 'text',
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
