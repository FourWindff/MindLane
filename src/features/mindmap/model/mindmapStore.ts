import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import type { Connection, Edge, Node, OnEdgesChange, OnNodesChange } from '@xyflow/react'
import { createEmptyFile, type MindLaneFile } from '@/shared/lib/fileFormat'
import { autoLayout } from '@/shared/lib/autoLayout'
import { parseYamlToMindmap } from '@/shared/lib/yamlMindmapParser'
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
  loadFromYaml: (yamlString: string, options?: { fileTitle?: string; filePath?: string | null }) => void
  newFile: (title?: string) => void
  clearDocument: () => void
  toMindLaneFile: () => MindLaneFile
  getContextSummary: () => string
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
      data: nodeRegistry.get(n.type)!.deserialize(n.data),
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

  loadFromYaml: (yamlString, options = {}) => {
    const parsed = parseYamlToMindmap(yamlString)
    const positioned = autoLayout(parsed.nodes, parsed.edges)
    set({
      nodes: positioned,
      edges: parsed.edges,
      hasDocumentOpen: true,
      filePath: options.filePath ?? null,
      fileTitle: options.fileTitle ?? parsed.title,
      dirty: true,
      editingNodeId: null,
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
          data: nodeRegistry.get(n.type!)!.serialize(n.data),
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

  getContextSummary: (): string => {
    const { nodes, edges, fileTitle } = get()
    const childrenMap = new Map<string, string[]>()
    for (const edge of edges) {
      const list = childrenMap.get(edge.source) ?? []
      list.push(edge.target)
      childrenMap.set(edge.source, list)
    }

    const parentSet = new Set(edges.map((e) => e.target))
    const roots = nodes.filter((n) => !parentSet.has(n.id))

    function describeNode(node: Node): string {
      const data = node.data as Record<string, unknown>
      switch (node.type) {
        case 'palace': {
          const stations = Array.isArray(data.stations) ? data.stations : []
          return `[宫殿] ${data.label ?? node.id} (${stations.length}个站点)`
        }
        case 'document':
          return `[文档] ${data.filename ?? node.id}${data.excerpt ? ` — ${String(data.excerpt).slice(0, 60)}` : ''}`
        default:
          return String(data.label ?? node.id)
      }
    }

    function renderTree(nodeId: string, depth: number): string {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return ''
      const indent = '  '.repeat(depth)
      const line = `${indent}- ${describeNode(node)}`
      const children = childrenMap.get(nodeId) ?? []
      const childLines = children.map((cid) => renderTree(cid, depth + 1)).filter(Boolean)
      return [line, ...childLines].join('\n')
    }

    const treeText = roots.map((r) => renderTree(r.id, 0)).filter(Boolean).join('\n')
    return `标题: ${fileTitle}\n节点数: ${nodes.length}\n\n${treeText}`
  },
}))
