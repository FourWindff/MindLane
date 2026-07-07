import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import type { Connection, Edge, Node, OnEdgesChange, OnNodesChange, Viewport } from '@xyflow/react'
import {
  createEmptyFile,
  type MindLaneFile,
  type DocumentRef,
  migrateDocumentRef,
  isTextNodeData,
  isPalaceNodeData,
} from '@/shared/lib/fileFormat'
import { autoLayout } from '@/shared/lib/autoLayout'
import { parseYamlFragment, VIRTUAL_ROOT_SYMBOL } from '@/shared/lib/yamlMindmapParser'
import { nodeRegistry } from '@/features/mindmap/nodes'
import { findRootNode, deserializeNode, CHILD_OFFSET_X } from '@/shared/lib/mindmapTree'

interface MindmapState {
  nodes: Node[]
  edges: Edge[]
  dirty: boolean
  hasDocumentOpen: boolean
  filePath: string | null
  fileTitle: string
  editingNodeId: string | null
  viewport: Viewport
  documentRefs: DocumentRef[]

  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: (connection: Connection) => void

  setEditingNodeId: (id: string | null) => void
  markClean: () => void
  setFilePath: (filePath: string) => void
  setFileTitle: (fileTitle: string) => void
  setViewport: (viewport: Viewport) => void

  loadFile: (filePath: string, data: MindLaneFile) => void
  newFile: (title?: string) => void
  clearDocument: () => void
  toMindLaneFile: () => MindLaneFile
  getContextSummary: () => string
  addDocumentRef: (ref: DocumentRef) => void

  insertNodesFromYaml: (
    yamlFragment: string,
    options?: { parentId?: string; fileTitle?: string },
  ) => void
}

const initialFile = createEmptyFile()

export const useMindmapStore = create<MindmapState>((set, get) => ({
  nodes: initialFile.mindmap.nodes as Node[],
  edges: initialFile.mindmap.edges as Edge[],
  dirty: false,
  hasDocumentOpen: false,
  filePath: null,
  fileTitle: initialFile.metadata.title,
  viewport: initialFile.mindmap.viewport,
  editingNodeId: null,
  documentRefs: [],

  setEditingNodeId: (id) => set({ editingNodeId: id }),

  setFilePath: (filePath) => set({ filePath }),

  setFileTitle: (fileTitle) => set({ fileTitle }),

  setViewport: (viewport) => set({ viewport }),

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
      edges: addEdge({ ...connection, type: 'mindmap' }, s.edges),
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
      documentRefs: (data.documents || []).map(migrateDocumentRef),
      hasDocumentOpen: true,
      filePath,
      fileTitle: data.metadata.title,
      dirty: false,
      viewport: data.mindmap.viewport,
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
      fileTitle: f.metadata.title,
      dirty: false,
      viewport: f.mindmap.viewport,
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
      viewport: f.mindmap.viewport,
      documentRefs: [],
    })
  },

  toMindLaneFile: (): MindLaneFile => {
    const { nodes, edges, fileTitle, viewport, documentRefs } = get()
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

  insertNodesFromYaml: (yamlFragment, options = {}) => {
    const { nodes: existingNodes, edges: existingEdges } = get()

    const parsed = parseYamlFragment(yamlFragment)

    const targetParentId =
      options.parentId ??
      existingNodes.find((n) => n.selected)?.id ??
      findRootNode(existingNodes, existingEdges)?.id ??
      existingNodes[0]?.id

    if (!targetParentId) {
      console.warn('[insertNodesFromYaml] 无法确定父节点')
      return
    }

    const parentNode = existingNodes.find((n) => n.id === targetParentId)
    if (!parentNode) {
      console.warn('[insertNodesFromYaml] 父节点不存在:', targetParentId)
      return
    }

    const laidOut = autoLayout(parsed.nodes, parsed.edges, {
      rootX: 0,
      rootY: 0,
      direction: 'LR',
    })

    const virtualRootIds = new Set<string>()
    for (const n of laidOut) {
      if ((n.data as Record<symbol, boolean>)[VIRTUAL_ROOT_SYMBOL]) {
        virtualRootIds.add(n.id)
      }
    }

    const subRootIds = parsed.rootIds
    if (subRootIds.length === 0) {
      console.warn('[insertNodesFromYaml] 无法找到子树根节点')
      return
    }

    const firstSubRoot = laidOut.find((n) => n.id === subRootIds[0])
    if (!firstSubRoot) {
      console.warn('[insertNodesFromYaml] 子树根节点不在布局结果中')
      return
    }

    const offsetX = parentNode.position.x + CHILD_OFFSET_X
    const offsetY = parentNode.position.y - firstSubRoot.position.y

    const deserializedNodes: Node[] = []
    for (const n of laidOut) {
      if (virtualRootIds.has(n.id)) continue
      const shifted = {
        ...n,
        position: {
          x: n.position.x + offsetX,
          y: n.position.y + offsetY,
        },
        data: { ...n.data, justAdded: true },
      }
      deserializedNodes.push(deserializeNode(shifted))
    }

    const newEdges: Edge[] = []
    for (const e of parsed.edges) {
      if (virtualRootIds.has(e.source) || virtualRootIds.has(e.target)) continue
      newEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type ?? 'mindmap',
        className: 'mindmap-edge mindmap-edge--enter',
      })
    }

    for (const subRootId of subRootIds) {
      newEdges.push({
        id: `e-${targetParentId}-${subRootId}`,
        source: targetParentId,
        target: subRootId,
        type: 'mindmap',
        className: 'mindmap-edge mindmap-edge--enter',
      })
    }

    set({
      nodes: [...existingNodes, ...deserializedNodes],
      edges: [...existingEdges, ...newEdges],
      dirty: true,
    })
  },
}))
