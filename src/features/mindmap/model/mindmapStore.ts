import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import type { Connection, Edge, Node, OnEdgesChange, OnNodesChange } from '@xyflow/react'
import { createEmptyFile, type MindLaneFile } from '@/shared/lib/fileFormat'
import { nodeRegistry } from '@/features/mindmap/nodes'

interface MindmapState {
  nodes: Node[]
  edges: Edge[]
  dirty: boolean
  hasDocumentOpen: boolean
  filePath: string | null
  fileTitle: string
  editingNodeId: string | null

  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: (connection: Connection) => void

  setEditingNodeId: (id: string | null) => void
  markClean: () => void
  setFilePath: (filePath: string) => void
  setFileTitle: (fileTitle: string) => void

  loadFile: (filePath: string, data: MindLaneFile) => void
  newFile: (title?: string) => void
  clearDocument: () => void
  toMindLaneFile: () => MindLaneFile
}

const initialFile = createEmptyFile()

export const useMindmapStore = create<MindmapState>((set, get) => ({
  nodes: initialFile.mindmap.nodes as Node[],
  edges: initialFile.mindmap.edges as Edge[],
  dirty: false,
  hasDocumentOpen: false,
  filePath: null,
  fileTitle: initialFile.metadata.title,
  editingNodeId: null,

  setEditingNodeId: (id) => set({ editingNodeId: id }),

  setFilePath: (filePath) => set({ filePath }),

  setFileTitle: (fileTitle) => set({ fileTitle }),

  setNodes: (updater) => {
    set((s) => ({
      nodes: typeof updater === 'function' ? updater(s.nodes) : updater,
      dirty: true,
    }))
  },

  setEdges: (updater) => {
    set((s) => ({
      edges: typeof updater === 'function' ? updater(s.edges) : updater,
      dirty: true,
    }))
  },

  onNodesChange: (changes) => {
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes),
      dirty: true,
    }))
  },

  onEdgesChange: (changes) => {
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
      dirty: true,
    }))
  },

  onConnect: (connection) => {
    set((s) => ({
      edges: addEdge({ ...connection, type: 'smoothstep' }, s.edges),
      dirty: true,
    }))
  },

  markClean: () => set({ dirty: false }),

  loadFile: (filePath, data) => {
    const hydratedNodes = data.mindmap.nodes.map((n) => ({
      ...n,
      data: nodeRegistry.deserializeNodeData(n.type, n.data),
    }))
    set({
      nodes: hydratedNodes as Node[],
      edges: data.mindmap.edges as Edge[],
      hasDocumentOpen: true,
      filePath,
      fileTitle: data.metadata.title,
      dirty: false,
    })
  },

  newFile: (title) => {
    const f = createEmptyFile(title)
    set({
      nodes: f.mindmap.nodes as Node[],
      edges: f.mindmap.edges as Edge[],
      hasDocumentOpen: true,
      filePath: null,
      fileTitle: f.metadata.title,
      dirty: false,
    })
  },

  clearDocument: () => {
    const f = createEmptyFile()
    set({
      nodes: f.mindmap.nodes as Node[],
      edges: f.mindmap.edges as Edge[],
      hasDocumentOpen: false,
      filePath: null,
      fileTitle: f.metadata.title,
      dirty: false,
      editingNodeId: null,
    })
  },

  toMindLaneFile: (): MindLaneFile => {
    const { nodes, edges, fileTitle } = get()
    const now = new Date().toISOString()
    return {
      version: '1.0',
      metadata: { title: fileTitle, createdAt: now, updatedAt: now },
      mindmap: {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type!,
          position: n.position,
          data: nodeRegistry.serializeNodeData(n.type!, n.data as Record<string, unknown>),
        })) as MindLaneFile['mindmap']['nodes'],
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
          className: e.className,
        })),
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      documents: [],
    }
  },
}))
