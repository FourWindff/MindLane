import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import type { Connection, Edge, Node, OnEdgesChange, OnNodesChange } from '@xyflow/react'
import { createEmptyFile, type MindLaneFile } from '@/shared/lib/fileFormat'
import { autoLayout } from '@/shared/lib/autoLayout'
import { parseYamlToMindmap, parseYamlFragment } from '@/shared/lib/yamlMindmapParser'
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

  /**
   * 从 YAML 片段批量插入节点到指定父节点下方
   */
  insertNodesFromYaml: (
    yamlFragment: string,
    options?: { parentId?: string; fileTitle?: string }
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
          return `[宫殿] ${data.label ?? node.id} (id: ${node.id}, ${stations.length}个站点)`
        }
        default:
          return `${String(data.label ?? node.id)} (id: ${node.id})`
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

  insertNodesFromYaml: (yamlFragment, options = {}) => {
    const { nodes: existingNodes, edges: existingEdges } = get()

    // 1. 解析 YAML 片段
    const parsed = parseYamlFragment(yamlFragment)

    // 2. 确定挂载目标
    let targetParentId = options.parentId
    if (!targetParentId) {
      const selected = existingNodes.find((n) => n.selected)
      if (selected) {
        targetParentId = selected.id
      } else {
        // 找根节点（没有入边的节点）
        const parentSet = new Set(existingEdges.map((e) => e.target))
        const root = existingNodes.find((n) => !parentSet.has(n.id))
        targetParentId = root?.id ?? existingNodes[0]?.id
      }
    }

    if (!targetParentId) {
      console.warn('[insertNodesFromYaml] 无法确定父节点')
      return
    }

    const parentNode = existingNodes.find((n) => n.id === targetParentId)
    if (!parentNode) {
      console.warn('[insertNodesFromYaml] 父节点不存在:', targetParentId)
      return
    }

    // 3. 为新子树做独立布局
    const laidOut = autoLayout(parsed.nodes, parsed.edges, {
      rootX: 0,
      rootY: 0,
      direction: 'LR',
    })

    // 4. 识别虚拟根节点（多根情况下 parseYamlFragment 会创建一个虚拟根）
    const virtualRootIds = new Set(
      laidOut
        .filter((n) => (n.data as { label?: string }).label === '__virtual_root__')
        .map((n) => n.id)
    )

    // 子树根：没有入边（单根）或只有虚拟根作为父节点（多根）的节点
    const subRootIds: string[] = []
    for (const n of laidOut) {
      if (virtualRootIds.has(n.id)) continue
      const realParents = parsed.edges.filter((e) => e.target === n.id && !virtualRootIds.has(e.source))
      if (realParents.length === 0) {
        subRootIds.push(n.id)
      }
    }

    if (subRootIds.length === 0) {
      console.warn('[insertNodesFromYaml] 无法找到子树根节点')
      return
    }

    // 以第一个子树根为基准计算偏移
    const firstSubRoot = laidOut.find((n) => n.id === subRootIds[0])
    if (!firstSubRoot) {
      console.warn('[insertNodesFromYaml] 无法找到子树根节点')
      return
    }

    const offsetX = parentNode.position.x + 260 // CHILD_OFFSET_X
    const offsetY = parentNode.position.y - firstSubRoot.position.y

    const shiftedNodes = laidOut.map((n) => ({
      ...n,
      position: {
        x: n.position.x + offsetX,
        y: n.position.y + offsetY,
      },
      data: { ...n.data, justAdded: true },
    }))

    // 5. 过滤掉虚拟根节点
    const realNodes = shiftedNodes.filter((n) => !virtualRootIds.has(n.id))

    // 6. 用 nodeRegistry 反序列化数据
    const deserializedNodes = realNodes.map((n) => {
      const descriptor = nodeRegistry.get(n.type!)
      return {
        ...n,
        data: descriptor ? descriptor.deserialize(n.data) : n.data,
      }
    })

    // 7. 构建边：复用 parsed.edges 中的内部边（排除虚拟根相关的边），并添加子树根到目标父节点的连接
    const newEdges: Edge[] = parsed.edges
      .filter((e) => !virtualRootIds.has(e.source) && !virtualRootIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type ?? 'smoothstep',
        className: 'mindmap-edge mindmap-edge--enter',
      }))

    for (const subRootId of subRootIds) {
      newEdges.push({
        id: `e-${targetParentId}-${subRootId}`,
        source: targetParentId,
        target: subRootId,
        type: 'smoothstep',
        className: 'mindmap-edge mindmap-edge--enter',
      })
    }

    // 7. 合并到现有图
    set({
      nodes: [...existingNodes, ...deserializedNodes],
      edges: [...existingEdges, ...newEdges],
      dirty: true,
    })
  },
}))
