import type { Connection, Edge, Node, NodeChange, EdgeChange } from '@xyflow/react'
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react'
import { type MindLaneFile, type MindLaneNode } from '@/shared/lib/fileFormat'
import { parseYamlFragment, VIRTUAL_ROOT_SYMBOL } from '@/shared/lib/yamlMindmapParser'
import { nodeRegistry } from '@/features/mindmap/nodes'
import {
  collectSubtreeIds,
  createInitialEdges,
  createInitialNodes,
  deserializeNode,
  findParentId,
  findRootNode,
  newId,
  CHILD_OFFSET_X,
} from '@/shared/lib/mindmapTree'
import type { MindmapState, MindmapStore } from './mindmapStore'
import { MindmapHistory } from './mindmapHistory'
import { mindmapLayout, type MindmapStructureType } from './mindmapLayout'
import {
  TRANSIENT_NODE_DATA_FLAGS,
  type MindmapCommand,
  type MindmapSnapshot,
  type TransientNodeDataFlag,
} from './types'

const NODE_EXIT_MS = 300

/**
 * 导图编辑器的唯一公共入口。所有结构变更（增删改、拖拽、连接、AI 批量插入）
 * 都应通过此类的方法执行，以便自动记录历史并支持撤销/重做。
 */
export class MindmapEditor {
  private structureType: MindmapStructureType = 'logic'
  private pendingDeleteTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    private store: MindmapStore,
    private history: MindmapHistory,
  ) {}

  private get state(): MindmapState {
    return this.store.getState()
  }

  // ─── 历史操作 ───

  undo(): void {
    this.cancelPendingDeletes()
    const before = this.history.undo()
    if (!before) return
    this.state.setNodes(before.nodes)
    this.state.setEdges(before.edges)
    this.syncHistoryState()
  }

  redo(): void {
    this.cancelPendingDeletes()
    const transaction = this.history.redo()
    if (!transaction) return
    const { nodes: appliedNodes, edges: appliedEdges } = this.applyCommand(
      transaction.before.nodes,
      transaction.before.edges,
      {
        type: 'batch',
        commands: transaction.commands,
      },
    )
    const nodes = this.shouldReflowAfter(transaction.commands)
      ? mindmapLayout.reflow(appliedNodes, appliedEdges, this.structureType)
      : appliedNodes
    this.state.setNodes(nodes)
    this.state.setEdges(appliedEdges)
    this.syncHistoryState()
  }

  get canUndo(): boolean {
    return this.history.canUndo
  }

  get canRedo(): boolean {
    return this.history.canRedo
  }

  // ─── 核心命令执行 ───

  execute(command: MindmapCommand): void {
    this.runBatch([command], false)
  }

  batch(commands: MindmapCommand[]): void {
    this.runBatch(commands, false)
  }

  private runBatch(commands: MindmapCommand[], skipReflow: boolean): void {
    if (commands.length === 0) return
    this.cancelPendingDeletes()
    const before = this.takeSnapshot()
    let nodes = this.state.nodes
    let edges = this.state.edges
    for (const command of commands) {
      const result = this.applyCommand(nodes, edges, command)
      nodes = result.nodes
      edges = result.edges
    }
    if (!skipReflow && this.shouldReflowAfter(commands)) {
      nodes = mindmapLayout.reflow(nodes, edges, this.structureType)
    }
    this.state.setNodes(nodes)
    this.state.setEdges(edges)
    this.history.record({
      id: crypto.randomUUID(),
      before,
      commands,
      timestamp: Date.now(),
    })
    this.syncHistoryState()
  }

  // ─── 便捷构建器 ───

  addNode(options: {
    type: string
    data: Record<string, unknown>
    parentId?: string
    position?: { x: number; y: number }
  }): { nodeId: string } {
    const nodes = this.state.nodes
    const edges = this.state.edges

    let parentId = options.parentId
    if (!parentId) {
      const selected = nodes.find((n) => n.selected)
      parentId = selected?.id ?? findRootNode(nodes, edges)?.id ?? nodes[0]?.id ?? 'root'
    }

    const parentNode = nodes.find((n) => n.id === parentId)
    const position =
      options.position ??
      (parentNode
        ? { x: parentNode.position.x + CHILD_OFFSET_X, y: parentNode.position.y }
        : { x: 0, y: 0 })

    const descriptor = nodeRegistry.get(options.type)
    const data = descriptor ? descriptor.deserialize(options.data) : options.data

    const nodeId = newId()
    const node: Node = {
      id: nodeId,
      type: options.type,
      position,
      data: { ...data, justAdded: true },
    }
    const edge: Edge | undefined =
      parentId && parentId !== nodeId
        ? {
            id: `e_${parentId}_${nodeId}`,
            source: parentId,
            target: nodeId,
            type: 'mindmap',
            className: 'mindmap-edge',
          }
        : undefined

    this.execute({ type: 'addNode', node, edge })
    return { nodeId }
  }

  addChild(parentId: string, data?: { label?: string }): { nodeId: string } {
    return this.addNode({
      type: 'text',
      data: { label: data?.label ?? '新主题' },
      parentId,
    })
  }

  addSibling(siblingId: string, data?: { label?: string }): { nodeId: string } | null {
    const parentId = findParentId(this.state.edges, siblingId)
    if (!parentId) return null
    return this.addNode({
      type: 'text',
      data: { label: data?.label ?? '新主题' },
      parentId,
    })
  }

  updateNode(nodeId: string, patch: (node: Node) => Node): void {
    this.execute({ type: 'updateNode', nodeId, patch })
  }

  updateNodeData(nodeId: string, nodeType: string, changes: Record<string, unknown>): void {
    const descriptor = nodeRegistry.get(nodeType)
    this.updateNode(nodeId, (n) => {
      const merged = { ...n.data, ...changes }
      return {
        ...n,
        data: descriptor ? descriptor.deserialize(merged) : merged,
      }
    })
  }

  deleteSubtree(rootId: string): void {
    this.deleteSubtrees([rootId])
  }

  deleteSubtrees(rootIds: string[]): void {
    const allIds = new Set<string>()
    for (const rootId of rootIds) {
      for (const id of collectSubtreeIds(this.state.edges, rootId)) allIds.add(id)
    }

    // 先标记退出动画（不进入历史，也不触发 dirty）
    this.state.setNodesTransient((nodes) =>
      nodes.map((n) => (allIds.has(n.id) ? { ...n, data: { ...n.data, exiting: true } } : n)),
    )
    this.state.setEdgesTransient((edges) =>
      edges.map((e) => {
        const touch = allIds.has(e.source) || allIds.has(e.target)
        if (!touch) return e
        const classes = new Set(
          [...(e.className ?? '').split(/\s+/), 'mindmap-edge', 'mindmap-edge--exiting'].filter(
            Boolean,
          ),
        )
        return { ...e, className: [...classes].join(' ') }
      }),
    )

    const timerId = setTimeout(() => {
      this.pendingDeleteTimers.delete(timerId)
      this.batch(rootIds.map((rootId) => ({ type: 'deleteSubtree' as const, rootId })))
    }, NODE_EXIT_MS)
    this.pendingDeleteTimers.add(timerId)
  }

  cancelPendingDeletes(): void {
    for (const id of this.pendingDeleteTimers) {
      clearTimeout(id)
    }
    this.pendingDeleteTimers.clear()
  }

  moveNode(nodeId: string, position: { x: number; y: number }): void {
    this.execute({ type: 'moveNode', nodeId, position })
  }

  addEdge(edge: Edge): void {
    this.execute({ type: 'addEdge', edge })
  }

  removeEdge(edgeId: string): void {
    this.execute({ type: 'removeEdge', edgeId })
  }

  addDocumentRef(ref: import('@/shared/lib/fileFormat').DocumentRef): void {
    this.state.addDocumentRef(ref)
  }

  // ─── YAML / AI 批量插入 ───

  insertFromYaml(yamlFragment: string, options: { parentId?: string } = {}): void {
    const nodes = this.state.nodes
    const edges = this.state.edges

    const parsed = parseYamlFragment(yamlFragment)
    const targetParentId =
      options.parentId ??
      nodes.find((n) => n.selected)?.id ??
      findRootNode(nodes, edges)?.id ??
      nodes[0]?.id

    if (!targetParentId) {
      console.warn('[insertFromYaml] 无法确定父节点')
      return
    }

    const parentNode = nodes.find((n) => n.id === targetParentId)
    if (!parentNode) {
      console.warn('[insertFromYaml] 父节点不存在:', targetParentId)
      return
    }

    const laidOut = mindmapLayout.initial(parsed.nodes, parsed.edges, {
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
      console.warn('[insertFromYaml] 无法找到子树根节点')
      return
    }

    const firstSubRoot = laidOut.find((n) => n.id === subRootIds[0])
    if (!firstSubRoot) {
      console.warn('[insertFromYaml] 子树根节点不在布局结果中')
      return
    }

    const offsetX = parentNode.position.x + CHILD_OFFSET_X
    const offsetY = parentNode.position.y - firstSubRoot.position.y

    const commands: MindmapCommand[] = []

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
      const node: Node = deserializeNode(shifted as Node)
      commands.push({ type: 'addNode', node })
    }

    for (const e of parsed.edges) {
      if (virtualRootIds.has(e.source) || virtualRootIds.has(e.target)) continue
      commands.push({
        type: 'addEdge',
        edge: {
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type ?? 'mindmap',
          className: 'mindmap-edge mindmap-edge--enter',
        },
      })
    }

    for (const subRootId of subRootIds) {
      commands.push({
        type: 'addEdge',
        edge: {
          id: `e-${targetParentId}-${subRootId}`,
          source: targetParentId,
          target: subRootId,
          type: 'mindmap',
          className: 'mindmap-edge mindmap-edge--enter',
        },
      })
    }

    this.runBatch(commands, true)
  }

  insertMindmapData(data: {
    nodes: MindLaneNode[]
    edges: { id: string; source: string; target: string; type?: string }[]
  }): void {
    const nodes = this.state.nodes
    const edges = this.state.edges

    const newTargets = new Set(data.edges.map((e) => e.target))
    const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x + (n.measured?.width ?? 200)), 0)
    const offsetX = nodes.length > 0 ? maxX + 300 : 0

    const commands: MindmapCommand[] = []

    for (const n of data.nodes) {
      const descriptor = nodeRegistry.get(n.type)
      const deserializedData = descriptor ? descriptor.deserialize(n.data) : n.data
      const isRoot = !newTargets.has(n.id)
      commands.push({
        type: 'addNode',
        node: {
          id: n.id,
          type: n.type,
          position: { x: offsetX, y: isRoot ? 0 : 50 },
          data: deserializedData,
        },
      })
    }

    for (const e of data.edges) {
      commands.push({
        type: 'addEdge',
        edge: {
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type ?? 'mindmap',
          className: 'mindmap-edge mindmap-edge--enter',
        },
      })
    }

    // 避免与现有边重复；AI 返回的 mindmapData 通常是独立子图
    const existingEdgeIds = new Set(edges.map((e) => e.id))
    const existingNodeIds = new Set(nodes.map((n) => n.id))
    const filteredCommands = commands.filter((c) => {
      if (c.type === 'addNode') return !existingNodeIds.has(c.node.id)
      if (c.type === 'addEdge') return !existingEdgeIds.has(c.edge.id)
      return true
    })

    this.runBatch(filteredCommands, true)
  }

  // ─── ReactFlow 原生变化转发 ───

  applyNativeNodeChanges(changes: NodeChange[], structureType: MindmapStructureType): void {
    this.structureType = structureType

    const positionChanges: Array<{ id: string; position: { x: number; y: number } }> = []
    const removeNodeIds: string[] = []
    const transientChanges: NodeChange[] = []

    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        positionChanges.push({ id: change.id, position: change.position })
      } else if (change.type === 'remove') {
        removeNodeIds.push(change.id)
      } else {
        transientChanges.push(change)
      }
    }

    if (transientChanges.length > 0) {
      this.state.setNodesTransient((nodes) => applyNodeChanges(transientChanges, nodes))
    }

    if (positionChanges.length > 0) {
      this.batch(
        positionChanges.map((c) => ({
          type: 'moveNode',
          nodeId: c.id,
          position: c.position,
        })),
      )
    }

    for (const nodeId of removeNodeIds) {
      if (nodeId === 'root') continue
      this.deleteSubtree(nodeId)
    }

    if (transientChanges.some((c) => c.type === 'dimensions')) {
      this.reflow()
    }
  }

  applyNativeEdgeChanges(changes: EdgeChange[]): void {
    const removeEdgeIds: string[] = []
    const transientChanges: EdgeChange[] = []

    for (const change of changes) {
      if (change.type === 'remove') {
        removeEdgeIds.push(change.id)
      } else {
        transientChanges.push(change)
      }
    }

    if (transientChanges.length > 0) {
      this.state.setEdgesTransient((edges) => applyEdgeChanges(transientChanges, edges))
    }

    for (const edgeId of removeEdgeIds) {
      this.removeEdge(edgeId)
    }
  }

  applyNativeConnect(connection: Connection): void {
    if (!connection.source || !connection.target) return
    const existing = this.state.edges.find(
      (e) => e.source === connection.source && e.target === connection.target,
    )
    if (existing) return

    const edge: Edge = {
      id: `e_${connection.source}_${connection.target}`,
      source: connection.source,
      target: connection.target,
      type: 'mindmap',
      className: 'mindmap-edge',
    }
    this.addEdge(edge)
  }

  // ─── 临时 UI 状态（不进入历史） ───

  setNodeEditing(nodeId: string, editing: boolean): void {
    this.state.setNodesTransient((nodes) =>
      nodes.map((n) => {
        if (n.id === nodeId)
          return { ...n, data: { ...n.data, editing: editing ? true : undefined } }
        // 开始编辑新节点时清除其它节点的编辑标记
        return editing && n.data.editing ? { ...n, data: { ...n.data, editing: undefined } } : n
      }),
    )
  }

  clearNodeFlag(nodeId: string, flag: TransientNodeDataFlag): void {
    this.state.setNodesTransient((nodes) =>
      nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, [flag]: undefined } } : n)),
    )
  }

  setNodeFlag(nodeId: string, flag: TransientNodeDataFlag, value: unknown): void {
    this.state.setNodesTransient((nodes) =>
      nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, [flag]: value } } : n)),
    )
  }

  setNodeSelected(nodeId: string | string[], selected: boolean): void {
    const ids = new Set(Array.isArray(nodeId) ? nodeId : [nodeId])
    this.state.setNodesTransient((nodes) =>
      nodes.map((n) => {
        if (ids.has(n.id)) return { ...n, selected }
        // 选择新节点时取消其它节点的选中状态，保持当前单选行为
        return selected ? { ...n, selected: false } : n
      }),
    )
  }

  setNodeExpanded(nodeId: string, expanded: boolean): void {
    this.state.setNodesTransient((nodes) =>
      nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, expanded } } : n)),
    )
  }

  clearNodeSelection(): void {
    this.state.setNodesTransient((nodes) => nodes.map((n) => ({ ...n, selected: false })))
  }

  // ─── 布局与生命周期 ───

  reflow(): void {
    const nodes = mindmapLayout.reflow(this.state.nodes, this.state.edges, this.structureType)
    this.state.setNodesTransient(nodes)
  }

  setStructureType(structureType: MindmapStructureType): void {
    this.structureType = structureType
    this.reflow()
  }

  reset(): void {
    this.state.setNodes(createInitialNodes() as Node[])
    this.state.setEdges(createInitialEdges())
    this.history.clear()
    this.syncHistoryState()
  }

  loadFile(filePath: string, data: MindLaneFile): void {
    this.state.loadFile(filePath, data)
    this.history.clear()
    this.syncHistoryState()
  }

  newFile(title?: string): void {
    this.state.newFile(title)
    this.history.clear()
    this.syncHistoryState()
  }

  clearDocument(): void {
    this.state.clearDocument()
    this.history.clear()
    this.syncHistoryState()
  }

  // ─── 内部工具 ───

  private takeSnapshot(): MindmapSnapshot {
    return {
      nodes: this.stripTransientFlags(this.state.nodes),
      edges: this.stripExitingEdgeClass(this.state.edges),
    }
  }

  private stripExitingEdgeClass(edges: Edge[]): Edge[] {
    return edges.map((e) => {
      if (!e.className?.includes('mindmap-edge--exiting')) return e
      const classes = e.className
        .split(/\s+/)
        .filter((c) => c !== 'mindmap-edge--exiting')
        .join(' ')
      return { ...e, className: classes || undefined }
    })
  }

  private stripTransientFlags(nodes: Node[]): Node[] {
    return nodes.map((n) => {
      const data = { ...n.data }
      for (const flag of TRANSIENT_NODE_DATA_FLAGS) {
        delete data[flag]
      }
      return { ...n, data, selected: undefined }
    })
  }

  private shouldReflowAfter(commands: MindmapCommand[]): boolean {
    return commands.some((c) => {
      if (c.type === 'moveNode') return false
      if (c.type === 'batch') return this.shouldReflowAfter(c.commands)
      return true
    })
  }

  private applyCommand(
    nodes: Node[],
    edges: Edge[],
    command: MindmapCommand,
  ): { nodes: Node[]; edges: Edge[] } {
    switch (command.type) {
      case 'addNode':
        return {
          nodes: [...nodes, command.node],
          edges: command.edge ? [...edges, command.edge] : edges,
        }
      case 'updateNode':
        return {
          nodes: nodes.map((n) => (n.id === command.nodeId ? command.patch(n) : n)),
          edges,
        }
      case 'deleteSubtree': {
        const ids = collectSubtreeIds(edges, command.rootId)
        return {
          nodes: nodes.filter((n) => !ids.has(n.id)),
          edges: edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
        }
      }
      case 'moveNode':
        return {
          nodes: nodes.map((n) =>
            n.id === command.nodeId ? { ...n, position: command.position } : n,
          ),
          edges,
        }
      case 'addEdge':
        return { nodes, edges: [...edges, command.edge] }
      case 'removeEdge':
        return { nodes, edges: edges.filter((e) => e.id !== command.edgeId) }
      case 'batch': {
        let result = { nodes, edges }
        for (const c of command.commands) {
          result = this.applyCommand(result.nodes, result.edges, c)
        }
        return result
      }
      default:
        return { nodes, edges }
    }
  }

  private syncHistoryState(): void {
    this.state.setHistoryAvailability(this.history.canUndo, this.history.canRedo)
  }
}
