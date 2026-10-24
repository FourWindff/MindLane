import type { Edge, Node, NodeChange, EdgeChange } from '@xyflow/react'
import type { MindLaneFile, MindLaneAsset } from '@contracts/fileFormat'
import { shouldRecordHistory } from '@contracts/mindmapDocument/commands'
import { layoutInitial } from '@contracts/mindmapDocument/layout'
import { defaultNodeSize } from '@contracts/mindmapDocument/nodeSize'
import {
  TRANSIENT_NODE_DATA_FLAGS,
  stripTransientNodeData,
  type MindmapCommand,
  type MindmapDocumentNode,
} from '@contracts/mindmapDocument/types'
import type { MindmapWireCommand } from '@contracts/mindmapDocument/wire'
import {
  MindmapXmlError,
  parseXmlFragment,
  validateFragmentForInsert,
  buildValidationContext,
} from '@contracts/mindmapXml'
import {
  CHILD_GAP_Y,
  CHILD_OFFSET_X,
  collectSubtreeIds,
  findParentId,
  findRootNode,
  getChildIdsOrdered,
  newId,
} from '@/features/mindmap/model/mindmapTree'
import { computeEnterDelays, computeExitDelays, totalExitDuration } from './cascadeTiming'
import type { OpenFileState, MindmapStore } from './store'

const NODE_EXIT_MS = 300
/** Glide animation length; keeps the transient `gliding` marker alive until the landing burst finishes. */
const GLIDE_MS = 1000

/** Sibling insertion position: end of all siblings / above / below the selected sibling. */
export type SiblingInsertMode = 'end' | 'above' | 'below'

type ViewFlags = Array<{ nodeId: string; flags: Record<string, unknown> }>

/** View-only data flags carried by a node's data (stripped before the command leaves the renderer). */
function pickTransientFlags(data: Record<string, unknown>): Record<string, unknown> {
  const flags: Record<string, unknown> = {}
  for (const flag of TRANSIENT_NODE_DATA_FLAGS) {
    if (flag in data) flags[flag] = data[flag]
  }
  return flags
}

function dataDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { data: Record<string, unknown>; viewFlags: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  const viewFlags: Record<string, unknown> = {}
  const transient = new Set<string>(TRANSIENT_NODE_DATA_FLAGS)
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (Object.is(before[key], after[key])) continue
    if (transient.has(key)) viewFlags[key] = after[key]
    else data[key] = after[key]
  }
  return { data, viewFlags }
}

/**
 * The renderer's mindmap view facade: it builds document commands from the
 * projected state and sends them down the one command channel. It no longer
 * owns the document, the history stack, the layout or a write path — the
 * main-process document service does. What stays here is the view-side
 * bookkeeping: animation markers, selection, deletion timers.
 */
export class MindmapEditor {
  private pendingDeleteTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(private store: MindmapStore) {}

  private get state(): OpenFileState {
    return this.store.getState()
  }

  /** Read the current projection (validation scenarios check existence/pure-tree against it). */
  getState(): OpenFileState {
    return this.state
  }

  /** Resolve once everything sent so far has landed in the projection. */
  whenSettled(): Promise<void> {
    return this.state.whenSettled()
  }

  // ─── History operations ───

  undo(): void {
    this.cancelPendingDeletes()
    this.state.undo()
  }

  redo(): void {
    this.cancelPendingDeletes()
    this.state.redo()
  }

  get canUndo(): boolean {
    return this.state.canUndo
  }

  get canRedo(): boolean {
    return this.state.canRedo
  }

  // ─── Core command execution ───

  execute(command: MindmapCommand): void {
    this.runBatch([command])
  }

  batch(commands: MindmapCommand[]): void {
    this.runBatch(commands)
  }

  private runBatch(commands: MindmapCommand[]): void {
    if (!shouldRecordHistory(commands)) return
    this.cancelPendingDeletes()
    const projected = this.toWireCommands(commands)
    this.state.applyCommands(projected.commands)
    this.applyViewFlags(projected.viewFlags)
  }

  /**
   * Translate the pure command values the renderer builds into the serializable
   * shape. `updateNode` patches are materialised against the current projection;
   * view-only data flags move to the renderer's own view state so they never
   * enter the document.
   */
  private toWireCommands(commands: MindmapCommand[]): {
    commands: MindmapWireCommand[]
    viewFlags: ViewFlags
  } {
    const wire: MindmapWireCommand[] = []
    const viewFlags: ViewFlags = []
    for (const command of commands) {
      switch (command.type) {
        case 'addNode': {
          const flags = pickTransientFlags(command.node.data)
          wire.push({ ...command, node: stripTransientNodeData(command.node) })
          if (Object.keys(flags).length > 0) viewFlags.push({ nodeId: command.node.id, flags })
          break
        }
        case 'updateNode': {
          const current = this.state.nodes.find((node) => node.id === command.nodeId)
          if (!current) {
            // Unknown ids are no-ops in the document; nothing to translate.
            break
          }
          const next = command.patch(current as unknown as MindmapDocumentNode) as unknown as Node
          const { data, viewFlags: flags } = dataDiff(
            current.data as Record<string, unknown>,
            next.data as Record<string, unknown>,
          )
          const position =
            next.position && !Object.is(current.position, next.position) ? next.position : undefined
          wire.push({
            type: 'updateNode',
            nodeId: command.nodeId,
            ...(Object.keys(data).length > 0 ? { data } : {}),
            ...(position ? { position } : {}),
          })
          if (Object.keys(flags).length > 0) viewFlags.push({ nodeId: command.nodeId, flags })
          break
        }
        case 'batch': {
          const nested = this.toWireCommands(command.commands)
          wire.push({ type: 'batch', commands: nested.commands })
          viewFlags.push(...nested.viewFlags)
          break
        }
        default:
          wire.push(command)
      }
    }
    return { commands: wire, viewFlags }
  }

  private applyViewFlags(viewFlags: ViewFlags): void {
    for (const { nodeId, flags } of viewFlags) {
      this.state.setNodeViewFlags(nodeId, flags)
    }
  }

  // ─── Convenience builders ───

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
    if (parentId === 'root' && !nodes.some((n) => n.id === 'root')) {
      // No root anchor (reset/empty document): use the first node as the parent
      parentId = nodes[0]?.id ?? 'root'
    }

    const parentNode = nodes.find((n) => n.id === parentId)
    const offsetX = CHILD_OFFSET_X
    const position =
      options.position ??
      (parentNode
        ? {
            x: parentNode.position.x + offsetX,
            y: this.endChildY(parentId, parentNode, nodes, edges),
          }
        : { x: 0, y: 0 })

    const data = options.data

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

  /**
   * Initial y for a new child: below all existing siblings so the layout's y-ordering
   * (getChildIdsOrdered) places it last. Falls back to the parent's y when it has no children.
   */
  private endChildY(parentId: string, parent: Node, nodes: Node[], edges: Edge[]): number {
    const siblings = getChildIdsOrdered(nodes, edges, parentId)
    if (siblings.length === 0) return parent.position.y
    const gapY = CHILD_GAP_Y
    let maxY = -Infinity
    for (const id of siblings) {
      const y = nodes.find((n) => n.id === id)?.position.y
      if (y !== undefined && y > maxY) maxY = y
    }
    return maxY + gapY
  }

  addChild(parentId: string, data?: { label?: string }): { nodeId: string } {
    return this.addNode({
      type: 'text',
      data: { label: data?.label ?? 'Untitled' },
      parentId,
    })
  }

  /**
   * Add a sibling of siblingId. mode 'above'/'below' insert right above/below the selected
   * sibling; 'end' (default) adds it as the last sibling. The new node inherits the sibling's
   * side so it stays on the same root branch.
   */
  addSibling(
    siblingId: string,
    data?: { label?: string },
    mode: SiblingInsertMode = 'end',
  ): { nodeId: string } | null {
    const parentId = findParentId(this.state.edges, siblingId)
    if (!parentId) return null
    const sibling = this.state.nodes.find((n) => n.id === siblingId)
    const parent = this.state.nodes.find((n) => n.id === parentId)
    const side = sibling?.data?.side
    let position: { x: number; y: number } | undefined
    if (sibling && mode !== 'end') {
      const offsetX = CHILD_OFFSET_X
      const gapY = CHILD_GAP_Y
      position = {
        x: (parent?.position.x ?? sibling.position.x) + offsetX,
        y: sibling.position.y + (mode === 'above' ? -gapY : gapY),
      }
    }
    return this.addNode({
      type: 'text',
      data: { label: data?.label ?? 'Untitled', ...(side ? { side } : {}) },
      parentId,
      position,
    })
  }

  /**
   * Add a parent above the node: a sibling node placed right above it, which the node is then
   * re-parented under. One batched history record (undo restores the whole change). Root cannot
   * get a parent. Returns null when the node has no parent.
   */
  addParent(nodeId: string, data?: { label?: string }): { nodeId: string } | null {
    const nodes = this.state.nodes
    const edges = this.state.edges
    const parentId = findParentId(edges, nodeId)
    const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined
    const node = nodes.find((n) => n.id === nodeId)
    if (!parentId || !parent || !node || nodeId === 'root') return null

    const offsetX = CHILD_OFFSET_X
    const gapY = CHILD_GAP_Y
    const newNodeId = newId()
    const newNode: Node = {
      id: newNodeId,
      type: 'text',
      position: {
        x: parent.position.x + offsetX,
        y: node.position.y - gapY,
      },
      data: {
        label: data?.label ?? 'Untitled',
        justAdded: true,
        ...(node.data.side ? { side: node.data.side } : {}),
        // Inherit the node's branchIndex so the branch keeps its color: the new parent
        // replaces the node as the branch head (the node just moves one level deeper).
        ...(typeof node.data.branchIndex === 'number'
          ? { branchIndex: node.data.branchIndex }
          : {}),
      },
    }
    const commands: MindmapCommand[] = [
      {
        type: 'addNode',
        node: newNode,
        edge: {
          id: `e_${parentId}_${newNodeId}`,
          source: parentId,
          target: newNodeId,
          type: 'mindmap',
          className: 'mindmap-edge',
        },
      },
    ]
    const incomingEdge = edges.find((e) => e.target === nodeId)
    if (incomingEdge) commands.push({ type: 'removeEdge', edgeId: incomingEdge.id })
    commands.push({
      type: 'addEdge',
      edge: {
        id: `e_${newNodeId}_${nodeId}`,
        source: newNodeId,
        target: nodeId,
        type: 'mindmap',
        className: 'mindmap-edge',
      },
    })
    this.batch(commands)
    return { nodeId: newNodeId }
  }

  updateNode(nodeId: string, patch: (node: Node) => Node): void {
    this.execute({
      type: 'updateNode',
      nodeId,
      patch: patch as unknown as (node: MindmapDocumentNode) => MindmapDocumentNode,
    })
  }

  updateNodeData(nodeId: string, changes: Record<string, unknown>): void {
    this.updateNode(nodeId, (n) => {
      const merged = { ...n.data, ...changes }
      return {
        ...n,
        data: merged,
      }
    })
  }

  /**
   * Toggle a node's collapsed state (a generic property, undoable through command history;
   * collapsing only affects display and keeps the subtree intact).
   */
  setNodeCollapsed(nodeId: string, collapsed: boolean): void {
    this.updateNodeData(nodeId, { collapsed: collapsed || undefined })
  }

  /**
   * Side collapse for the root node in bilateral layout: folds only the root's left
   * or right branch (that side's direct children and their subtrees).
   * When the whole map is collapsed via `collapsed`, expanding one side clears
   * `collapsed` and keeps the other side folded via its side flag; otherwise only
   * the matching leftCollapsed / rightCollapsed flag is toggled.
   */
  setNodeSideCollapsed(nodeId: string, side: 'left' | 'right', collapsed: boolean): void {
    const data = this.state.nodes.find((n) => n.id === nodeId)?.data ?? {}
    if (data.collapsed === true) {
      this.updateNodeData(nodeId, {
        collapsed: undefined,
        leftCollapsed: side === 'left' ? undefined : true,
        rightCollapsed: side === 'right' ? undefined : true,
      })
      return
    }
    const flag = side === 'left' ? 'leftCollapsed' : 'rightCollapsed'
    this.updateNodeData(nodeId, { [flag]: collapsed ? true : undefined })
  }

  /**
   * Move a subtree to a new position (detach + reattach + reflow, one atomic batch history entry).
   * position: child=attach under targetId (default); after/before=become the sibling before/after targetId.
   * root cannot be moved; the target must not sit inside the moved subtree (cycle).
   */
  moveSubtree(
    nodeId: string,
    targetId: string,
    position: 'child' | 'after' | 'before' = 'child',
  ): void {
    if (nodeId === 'root' || targetId === nodeId) return
    const edges = this.state.edges
    const subtreeIds = collectSubtreeIds(edges, nodeId)
    if (subtreeIds.has(targetId)) return

    const oldParentId = findParentId(edges, nodeId)
    const newParentId =
      position === 'child'
        ? targetId
        : (findParentId(edges, targetId) ?? findRootNode(this.state.nodes, edges)?.id)
    if (!newParentId || newParentId === nodeId) return
    if (position === 'child' && newParentId === oldParentId) return

    const commands: MindmapCommand[] = []
    const incomingEdge = edges.find((e) => e.target === nodeId)
    if (incomingEdge) {
      commands.push({ type: 'removeEdge', edgeId: incomingEdge.id })
    }

    // after/before: align vertically above/below the target sibling so reflow keeps sibling order
    if (position !== 'child' && oldParentId === newParentId) {
      const sibling = this.state.nodes.find((n) => n.id === targetId)
      const node = this.state.nodes.find((n) => n.id === nodeId)
      if (sibling && node) {
        const siblingH = sibling.measured?.height ?? defaultNodeSize(sibling.type).height
        const nodeH = node.measured?.height ?? defaultNodeSize(node.type).height
        const gapY = CHILD_GAP_Y
        const align =
          position === 'before'
            ? sibling.position.y - gapY - nodeH
            : sibling.position.y + siblingH + gapY
        commands.push({ type: 'moveNode', nodeId, position: { x: node.position.x, y: align } })
      }
    }

    commands.push({
      type: 'addEdge',
      edge: {
        id: `e-${newParentId}-${nodeId}`,
        source: newParentId,
        target: nodeId,
        type: 'mindmap',
        className: 'mindmap-edge',
      },
    })
    // The glide marker must be present on the render BEFORE the position batch
    // lands: stamp gliding/glideFrom at the old positions, then send the batch in
    // the same tick so the view layer can transition. The marker is view state
    // (never part of the document); the cleanup timer is a no-op on a disposed store.
    const oldPositions = new Map<string, { x: number; y: number }>()
    for (const id of subtreeIds) {
      const node = this.state.nodes.find((n) => n.id === id)
      if (node) oldPositions.set(id, { x: node.position.x, y: node.position.y })
    }
    for (const [id, from] of oldPositions) {
      this.state.setNodeViewFlags(id, { gliding: true, glideFrom: from })
    }
    this.runBatch(commands)
    setTimeout(() => {
      for (const id of subtreeIds) {
        this.state.clearNodeFlag(id, 'gliding')
        this.state.clearNodeFlag(id, 'glideFrom')
      }
    }, GLIDE_MS)
  }

  deleteSubtree(rootId: string): void {
    this.deleteSubtrees([rootId])
  }

  deleteSubtrees(rootIds: string[]): void {
    const edges = this.state.edges
    const allIds = new Set<string>()
    for (const rootId of rootIds) {
      if (rootId === 'root') continue
      for (const id of collectSubtreeIds(edges, rootId)) allIds.add(id)
    }

    // Reverse cascade exit: leaves start exiting first, the parent last
    // (`exitingDelay` drives the view animation delay); the final batch delete
    // stays atomic with unchanged history semantics. A single node degrades to
    // the existing behaviour (0ms delay + delete after NODE_EXIT_MS).
    const exitDelays = computeExitDelays(
      rootIds.filter((r) => r !== 'root'),
      this.state.nodes,
      edges,
    )

    this.markExiting(allIds, exitDelays)
    this.scheduleDelete(
      rootIds.map((rootId) => ({ type: 'deleteSubtree' as const, rootId })),
      totalExitDuration(exitDelays, NODE_EXIT_MS),
    )
  }

  /**
   * Delete one node and promote its children to its parent (their subtrees are kept,
   * one atomic history entry). The node itself still plays the plain exit animation.
   */
  deleteNodeKeepingChildren(nodeId: string): void {
    const { nodes, edges } = this.state
    if (nodeId === 'root' || !nodes.some((n) => n.id === nodeId)) return
    const parentId = findParentId(edges, nodeId)
    if (!parentId) return

    const node = nodes.find((n) => n.id === nodeId)!
    const commands: MindmapCommand[] = []
    getChildIdsOrdered(nodes, edges, nodeId).forEach((childId, index) => {
      const incoming = edges.find((e) => e.target === childId)
      if (incoming) commands.push({ type: 'removeEdge', edgeId: incoming.id })
      commands.push({
        type: 'addEdge',
        edge: {
          id: `e-${parentId}-${childId}`,
          source: parentId,
          target: childId,
          type: 'mindmap',
          className: 'mindmap-edge',
        },
      })
      // Stack the promoted children at the deleted node's slot: the reflow orders
      // siblings by y, so this keeps their order without interleaving with the
      // surviving siblings.
      commands.push({
        type: 'moveNode',
        nodeId: childId,
        position: { x: node.position.x, y: node.position.y + index * CHILD_GAP_Y },
      })
    })
    // The batch reattaches the child edges before `deleteSubtree` runs, so the deleted
    // subtree is just the node itself here. One history entry: a single undo restores all.
    commands.push({ type: 'deleteSubtree', rootId: nodeId })

    this.markExiting(new Set([nodeId]), new Map())
    this.scheduleDelete(commands, NODE_EXIT_MS)
  }

  cancelPendingDeletes(): void {
    for (const id of this.pendingDeleteTimers) {
      clearTimeout(id)
    }
    this.pendingDeleteTimers.clear()
  }

  /** Mark nodes (and the edges touching them) as exiting: view state, not recorded in history, no dirty flag. */
  private markExiting(ids: Set<string>, exitDelays: Map<string, number>): void {
    for (const id of ids) {
      const delay = exitDelays.get(id) ?? 0
      this.state.setNodeViewFlags(id, {
        exiting: true,
        ...(delay > 0 ? { exitingDelay: delay } : {}),
      })
    }
    for (const edge of this.state.edges) {
      if (!ids.has(edge.source) && !ids.has(edge.target)) continue
      // Drop a lingering `mindmap-edge--enter` marker: agent-inserted edges
      // keep it forever (nodes clear theirs on animationend, edges have no
      // cleanup), and a completed enter animation (fill-mode both) pins the
      // path at opacity 1, blocking the exit transition below.
      const classes = new Set(
        [...(edge.className ?? '').split(/\s+/), 'mindmap-edge', 'mindmap-edge--exiting'].filter(
          (name) => Boolean(name) && name !== 'mindmap-edge--enter',
        ),
      )
      this.state.setEdgeClassName(edge.id, [...classes].join(' '))
    }
  }

  /** Commit the delete batch after the exit animation; tracked so any later batch cancels it. */
  private scheduleDelete(commands: MindmapCommand[], delay: number): void {
    const timerId = setTimeout(() => {
      this.pendingDeleteTimers.delete(timerId)
      this.batch(commands)
    }, delay)
    this.pendingDeleteTimers.add(timerId)
  }

  moveNode(nodeId: string, position: { x: number; y: number }): void {
    if (nodeId === 'root') return
    this.execute({ type: 'moveNode', nodeId, position })
  }

  addEdge(edge: Edge): void {
    this.execute({ type: 'addEdge', edge })
  }

  removeEdge(edgeId: string): void {
    this.execute({ type: 'removeEdge', edgeId })
  }

  addDocumentRef(ref: import('@contracts/fileFormat').DocumentRef): void {
    this.state.addDocumentRef(ref)
  }

  // ─── AI batch insert ───

  /**
   * Parse and insert an XML fragment (one of the unified entry points for AI write actions).
   * A failed validation throws MindmapXmlError (the error code goes back to the AI) and mounts nothing partially.
   * position: child=attach under parentId (default); after/before=insert before/after parentId's sibling;
   * root=attach to the root node.
   */
  async insertFromXml(
    xml: string,
    options: { parentId?: string; position?: 'root' | 'child' | 'after' | 'before' } = {},
    pendingAssets: MindLaneAsset[] = [],
  ): Promise<void> {
    const parsed = await parseXmlFragment(xml)
    const { ctx } = buildValidationContext(this.state.nodes, this.state.edges, [
      ...this.state.assets,
      ...pendingAssets,
    ])
    validateFragmentForInsert(parsed, ctx)

    const position = options.position ?? 'child'
    if ((position === 'after' || position === 'before') && !options.parentId?.trim()) {
      throw new MindmapXmlError(
        'block_not_found',
        `Inserting at position "${position}" requires an anchor node`,
      )
    }
    if (position !== 'root' && options.parentId && !ctx.nodeIds.has(options.parentId)) {
      throw new MindmapXmlError(
        'block_not_found',
        `Anchor node "${options.parentId}" does not exist`,
      )
    }
    // Pending assets become live only after parsing and structural validation succeed.
    for (const asset of pendingAssets) this.state.addAsset(asset)
    if (position === 'after' || position === 'before') {
      this.insertParsedFragmentSibling(parsed, {
        siblingId: options.parentId ?? '',
        before: position === 'before',
      })
      await this.whenSettled()
      return
    }
    const parentId = position === 'root' ? 'root' : options.parentId
    this.insertParsedFragment(parsed, { parentId })
    await this.whenSettled()
  }

  /**
   * Replace a whole node (including its subtree, the updateMindmapNode front end):
   * delete the old subtree, then reattach the fragment (same root id) under the old
   * parent as one batch history entry.
   */
  async replaceNodeFromXml(xml: string, pendingAssets: MindLaneAsset[] = []): Promise<void> {
    const parsed = await parseXmlFragment(xml)
    if (parsed.rootIds.length !== 1) {
      throw new MindmapXmlError(
        'tree_invalid',
        'updateMindmapNode must provide exactly one root <node> (including its subtree)',
      )
    }
    const nodeId = parsed.rootIds[0]!
    if (nodeId === 'root') {
      throw new MindmapXmlError('tree_invalid', 'root is the mindmap anchor and cannot be replaced')
    }
    const nodes = this.state.nodes
    const edges = this.state.edges
    if (!nodes.some((n) => n.id === nodeId)) {
      throw new MindmapXmlError(
        'block_not_found',
        `Node "${nodeId}" does not exist; call readMindmap to locate it again`,
      )
    }
    const { ctx } = buildValidationContext(nodes, edges, [...this.state.assets, ...pendingAssets])
    validateFragmentForInsert(parsed, ctx, new Set([nodeId]))

    // Keep materialization in the same validated write operation as the replacement.
    for (const asset of pendingAssets) this.state.addAsset(asset)

    // Order preservation: record the old position and the old parent edge index before
    // deleting. On reattach the root node restores its old position (otherwise (0,0)
    // drifts in the y reorder) and the parent edge goes back at its old index (otherwise
    // the edges order, which is the XML serialization/save order, puts the node last).
    const oldParentId = findParentId(edges, nodeId)
    const oldNode = nodes.find((n) => n.id === nodeId)
    const oldEdgeIndex = edges.findIndex((e) => e.target === nodeId)
    // The replacement subtree cascades in parent-first, same as fragments (the
    // single-root constraint here rules out multi-root independence).
    const enterDelays = computeEnterDelays([nodeId], parsed.nodes, parsed.edges)
    const commands: MindmapCommand[] = [{ type: 'deleteSubtree', rootId: nodeId }]
    for (const n of parsed.nodes) {
      commands.push({
        type: 'addNode',
        node: {
          ...n,
          position: n.id === nodeId && oldNode?.position ? oldNode.position : n.position,
          data: {
            ...n.data,
            justAdded: true,
            cascadeDelay: enterDelays.get(n.id) ?? 0,
          },
        },
      })
    }
    if (oldParentId) {
      commands.push({
        type: 'addEdge',
        edge: {
          id: `e-${oldParentId}-${nodeId}`,
          source: oldParentId,
          target: nodeId,
          type: 'mindmap',
          className: 'mindmap-edge mindmap-edge--enter',
        },
        index: oldEdgeIndex >= 0 ? oldEdgeIndex : undefined,
      })
    }
    for (const e of parsed.edges) {
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
    this.runBatch(commands)
    await this.whenSettled()
  }

  /**
   * The map-landing logic behind insertFromXml (layout/aggregation/history/fallback chain aligned).
   * Fallback chain: explicit parentId -> selected node -> root node.
   */
  private insertParsedFragment(
    parsed: { nodes: Node[]; edges: Edge[]; rootIds: string[] },
    options: { parentId?: string },
  ): void {
    const nodes = this.state.nodes
    const edges = this.state.edges

    const targetParentId =
      options.parentId ??
      nodes.find((n) => n.selected)?.id ??
      findRootNode(nodes, edges)?.id ??
      nodes[0]?.id

    if (!targetParentId) {
      console.warn('[insertParsedFragment] cannot determine the parent node')
      return
    }

    const parentNode = nodes.find((n) => n.id === targetParentId)
    if (!parentNode) {
      console.warn('[insertParsedFragment] parent node does not exist:', targetParentId)
      return
    }

    const anchorX = parentNode.position.x + CHILD_OFFSET_X
    this.insertParsedFragmentAt(parsed, targetParentId, anchorX, parentNode.position.y)
  }

  /**
   * Sibling-anchored insert (after/before): the target parent is the sibling's parent and the
   * fragment is aligned vertically above/below the sibling.
   */
  private insertParsedFragmentSibling(
    parsed: { nodes: Node[]; edges: Edge[]; rootIds: string[] },
    options: { siblingId: string; before: boolean },
  ): void {
    const nodes = this.state.nodes
    const edges = this.state.edges
    const sibling = nodes.find((n) => n.id === options.siblingId)
    if (!sibling) {
      console.warn('[insertParsedFragmentSibling] sibling node does not exist:', options.siblingId)
      return
    }
    const parentId = findParentId(edges, options.siblingId) ?? findRootNode(nodes, edges)?.id
    if (!parentId) {
      console.warn('[insertParsedFragmentSibling] cannot determine the sibling parent node')
      return
    }
    const parentNode = nodes.find((n) => n.id === parentId)
    if (!parentNode) return

    const siblingH = sibling.measured?.height ?? defaultNodeSize(sibling.type).height
    const firstH = defaultNodeSize(parsed.nodes[0]?.type ?? 'text').height
    const anchorX = parentNode.position.x + CHILD_OFFSET_X
    const anchorY = options.before
      ? sibling.position.y - CHILD_GAP_Y - firstH
      : sibling.position.y + siblingH + CHILD_GAP_Y
    this.insertParsedFragmentAt(parsed, parentId, anchorX, anchorY)
  }

  /**
   * Shared fragment-landing core: dagre initial layout -> translate to align the anchor ->
   * batch commands -> one history entry.
   */
  private insertParsedFragmentAt(
    parsed: { nodes: Node[]; edges: Edge[]; rootIds: string[] },
    targetParentId: string,
    anchorX: number,
    anchorY: number,
  ): void {
    const laidOut = layoutInitial(parsed.nodes as MindmapDocumentNode[], parsed.edges) as Node[]

    const subRootIds = parsed.rootIds
    if (subRootIds.length === 0) {
      console.warn('[insertParsedFragment] cannot find the subtree root node')
      return
    }

    const firstSubRoot = laidOut.find((n) => n.id === subRootIds[0])
    if (!firstSubRoot) {
      console.warn('[insertParsedFragment] the subtree root node is not in the layout result')
      return
    }

    const offsetX = anchorX - firstSubRoot.position.x
    const offsetY = anchorY - firstSubRoot.position.y

    // Cascade entrance: DFS pre-order (parent before child, siblings in layout
    // order) computes a per-node delay; multi-root fragments keep subtrees
    // independent. Stamped into the addNode commands so it lands with the
    // fragment (a view-only marker, moved to the renderer view state).
    const enterDelays = computeEnterDelays(subRootIds, laidOut, parsed.edges)

    const commands: MindmapCommand[] = []

    for (const n of laidOut) {
      const shifted = {
        ...n,
        position: {
          x: n.position.x + offsetX,
          y: n.position.y + offsetY,
        },
        data: {
          ...n.data,
          justAdded: true,
          // Always written (including 0): cascadeDelay present = this node came
          // from an agent write path; the view uses it to tell manual inserts
          // (no cascade/particles) apart from agent fragments.
          cascadeDelay: enterDelays.get(n.id) ?? 0,
        },
      }
      const node: Node = shifted as Node
      commands.push({ type: 'addNode', node })
    }

    for (const e of parsed.edges) {
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

    // Reflow happens in the document service; the renderer only provides the
    // anchored command inputs.
    this.runBatch(commands)
  }

  // ─── ReactFlow native change forwarding ───

  applyNativeNodeChanges(changes: NodeChange[]): void {
    const positionChanges: Array<{ id: string; position: { x: number; y: number } }> = []
    const sizeChanges: Array<{ id: string; width: number; height: number }> = []
    const removeNodeIds: string[] = []

    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        if (change.dragging) {
          // Drag is a local preview; the document only learns the final position.
          this.state.previewNodePosition(change.id, change.position)
          continue
        }
        // The preview stays until the versioned state shows the same position.
        positionChanges.push({ id: change.id, position: change.position })
      } else if (change.type === 'remove') {
        removeNodeIds.push(change.id)
      } else if (change.type === 'select') {
        this.state.setNodeSelection(change.id, change.selected)
      } else if (change.type === 'dimensions' && change.dimensions) {
        sizeChanges.push({
          id: change.id,
          width: change.dimensions.width,
          height: change.dimensions.height,
        })
      }
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

    if (sizeChanges.length > 0) {
      this.reflow({ sizes: sizeChanges })
    }
  }

  applyNativeEdgeChanges(changes: EdgeChange[]): void {
    for (const change of changes) {
      if (change.type === 'remove') {
        this.removeEdge(change.id)
      } else if (change.type === 'select') {
        this.state.setEdgeSelection(change.id, change.selected)
      }
    }
  }

  setNodeEditing(nodeId: string, editing: boolean): void {
    this.state.setNodeEditing(nodeId, editing)
  }

  clearNodeFlag(
    nodeId: string,
    flag: import('@contracts/mindmapDocument/types').TransientNodeDataFlag,
  ): void {
    this.state.clearNodeFlag(nodeId, flag)
  }

  setNodeFlag(
    nodeId: string,
    flag: import('@contracts/mindmapDocument/types').TransientNodeDataFlag,
    value: unknown,
  ): void {
    this.state.setNodeFlag(nodeId, flag, value)
  }

  setNodeSelected(nodeId: string | string[], selected: boolean): void {
    this.state.setNodeSelected(nodeId, selected)
  }

  setNodeExpanded(nodeId: string, expanded: boolean): void {
    this.state.setNodeFlag(nodeId, 'expanded', expanded)
  }

  clearNodeSelection(): void {
    this.state.clearNodeSelection()
  }

  // ─── Layout and lifecycle ───

  reflow(options?: { sizes?: Array<{ id: string; width: number; height: number }> }): void {
    this.state.relayout({
      structureType: this.state.style.structureType,
      ...(options?.sizes ? { sizes: options.sizes } : {}),
    })
  }

  reset(): void {
    this.state.resetDocument()
  }

  loadFile(filePath: string, data: MindLaneFile, workspacePath: string | null): void {
    this.state.loadFile(filePath, data, workspacePath)
  }
}
