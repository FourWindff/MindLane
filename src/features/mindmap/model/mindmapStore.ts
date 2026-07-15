import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { Edge, Node, Viewport } from '@xyflow/react'
import {
  createEmptyFile,
  type MindLaneFile,
  type DocumentRef,
  migrateDocumentRef,
  isTextNodeData,
  isPalaceNodeData,
} from '@/shared/lib/fileFormat'
import { nodeRegistry } from '@/features/mindmap/nodes'

export interface MindmapState {
  nodes: Node[]
  edges: Edge[]
  dirty: boolean
  hasDocumentOpen: boolean
  filePath: string | null
  fileUuid: string
  fileTitle: string
  fileCreatedAt: string
  editingNodeId: string | null
  viewport: Viewport
  documentRefs: DocumentRef[]
  canUndo: boolean
  canRedo: boolean

  /** @internal 仅供 MindmapEditor 写入；外部代码应通过 Editor 修改结构。 */
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void
  /** @internal 仅供 MindmapEditor 写入；外部代码应通过 Editor 修改结构。 */
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void

  /** @internal 仅供 MindmapEditor 调用；用于无脏标记的临时 UI 更新。 */
  setNodesTransient: (nodes: Node[] | ((prev: Node[]) => Node[])) => void
  /** @internal 仅供 MindmapEditor 调用；用于无脏标记的临时 UI 更新。 */
  setEdgesTransient: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void

  setEditingNodeId: (id: string | null) => void
  markClean: () => void
  setFilePath: (filePath: string) => void
  setFileTitle: (fileTitle: string) => void
  setViewport: (viewport: Viewport) => void
  /** @internal 由 MindmapEditor 调用以同步历史可用状态。 */
  setHistoryAvailability: (canUndo: boolean, canRedo: boolean) => void

  loadFile: (filePath: string, data: MindLaneFile) => void
  newFile: (title?: string) => void
  clearDocument: () => void
  toMindLaneFile: () => MindLaneFile
  getContextSummary: () => string
  addDocumentRef: (ref: DocumentRef) => void
}

export type MindmapStore = UseBoundStore<StoreApi<MindmapState>>

const initialFile = createEmptyFile()

export function createMindmapStore(): MindmapStore {
  return create<MindmapState>((set, get) => ({
    nodes: initialFile.mindmap.nodes as Node[],
    edges: initialFile.mindmap.edges as Edge[],
    dirty: false,
    hasDocumentOpen: false,
    filePath: null,
    fileUuid: initialFile.metadata.fileUuid,
    fileTitle: initialFile.metadata.title,
    fileCreatedAt: initialFile.metadata.createdAt,
    viewport: initialFile.mindmap.viewport,
    editingNodeId: null,
    documentRefs: [],
    canUndo: false,
    canRedo: false,

    setEditingNodeId: (id) => set({ editingNodeId: id }),

    setFilePath: (filePath) => set({ filePath }),

    setFileTitle: (fileTitle) => set({ fileTitle }),

    setViewport: (viewport) => set({ viewport }),

    setHistoryAvailability: (canUndo, canRedo) => set({ canUndo, canRedo }),

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

    setNodesTransient: (updater) => {
      set((s) => ({
        nodes: typeof updater === 'function' ? updater(s.nodes) : updater,
      }))
    },

    setEdgesTransient: (updater) => {
      set((s) => ({
        edges: typeof updater === 'function' ? updater(s.edges) : updater,
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
        documentRefs: (data.documents || []).map(migrateDocumentRef),
        hasDocumentOpen: true,
        filePath,
        fileUuid: data.metadata.fileUuid,
        fileTitle: data.metadata.title,
        fileCreatedAt: data.metadata.createdAt,
        dirty: false,
        viewport: data.mindmap.viewport,
        canUndo: false,
        canRedo: false,
      })
    },

    newFile: (title) => {
      const f = createEmptyFile(title)
      set({
        nodes: f.mindmap.nodes as Node[],
        edges: f.mindmap.edges as Edge[],
        documentRefs: [],
        hasDocumentOpen: true,
        filePath: null,
        fileUuid: f.metadata.fileUuid,
        fileTitle: f.metadata.title,
        fileCreatedAt: f.metadata.createdAt,
        dirty: false,
        viewport: f.mindmap.viewport,
        canUndo: false,
        canRedo: false,
      })
    },

    clearDocument: () => {
      const f = createEmptyFile()
      set({
        nodes: f.mindmap.nodes as Node[],
        edges: f.mindmap.edges as Edge[],
        hasDocumentOpen: false,
        filePath: null,
        fileUuid: f.metadata.fileUuid,
        fileTitle: f.metadata.title,
        fileCreatedAt: f.metadata.createdAt,
        dirty: false,
        editingNodeId: null,
        viewport: f.mindmap.viewport,
        documentRefs: [],
        canUndo: false,
        canRedo: false,
      })
    },

    toMindLaneFile: (): MindLaneFile => {
      const { nodes, edges, fileUuid, fileTitle, fileCreatedAt, viewport, documentRefs } = get()
      const now = new Date().toISOString()
      return {
        version: '1.0',
        metadata: { fileUuid, title: fileTitle, createdAt: fileCreatedAt, updatedAt: now },
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
          viewport,
        },
        documents: documentRefs,
      }
    },

    addDocumentRef: (ref) => {
      set((s) => ({
        documentRefs: [...s.documentRefs.filter((doc) => doc.id !== ref.id), ref],
        dirty: true,
      }))
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
        switch (node.type) {
          case 'palace': {
            if (isPalaceNodeData(node.data)) {
              return `[宫殿] ${node.data.label} (id: ${node.id}, ${node.data.stations.length}个站点)`
            }
            return `[宫殿] ${node.id}`
          }
          default:
            if (isTextNodeData(node.data)) {
              return `${node.data.label} (id: ${node.id})`
            }
            return `${node.id}`
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

      const treeText = roots
        .map((r) => renderTree(r.id, 0))
        .filter(Boolean)
        .join('\n')
      return `标题: ${fileTitle}\n节点数: ${nodes.length}\n\n${treeText}`
    },
  }))
}
