import type { TextNodeData } from '@/features/mindmap/nodes/text/types'
import { nodeRegistry } from '@/features/mindmap/nodes'
import { Position, type Edge, type Node } from '@xyflow/react'

export const CHILD_OFFSET_X = 260
export const CHILD_GAP_Y = 24

export function newId(): string {
  return crypto.randomUUID()
}

export function createInitialNodes(): Node[] {
  return [
    {
      id: 'root',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { label: '中心主题', depth: 0, branchIndex: -1 },
    },
  ]
}

export function createInitialEdges(): Edge[] {
  return []
}

export function findParentId(edges: Edge[], nodeId: string): string | null {
  const e = edges.find((x) => x.target === nodeId)
  return e?.source ?? null
}

function getChildIds(edges: Edge[], parentId: string): string[] {
  return edges.filter((e) => e.source === parentId).map((e) => e.target)
}

export function collectSubtreeIds(edges: Edge[], rootId: string): Set<string> {
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    ids.add(id)
    getChildIds(edges, id).forEach((c) => stack.push(c))
  }
  return ids
}

export function getChildIdsOrdered(nodes: Node[], edges: Edge[], parentId: string): string[] {
  const ids = getChildIds(edges, parentId)
  const y = new Map(nodes.map((n) => [n.id, n.position.y]))
  return [...ids].sort((a, b) => (y.get(a) ?? 0) - (y.get(b) ?? 0))
}

export function findRootNode(nodes: Node[], edges: Edge[]): Node | undefined {
  const parentSet = new Set(edges.map((e) => e.target))
  return nodes.find((n) => !parentSet.has(n.id))
}

const DEFAULT_NODE_HEIGHT = 40
const DEFAULT_NODE_WIDTH = 160
const PALACE_NODE_HEIGHT = 200
const PALACE_NODE_WIDTH = 260

function nodeHeight(nodeId: string, nodes: Node[]): number {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return DEFAULT_NODE_HEIGHT
  if (node.measured?.height) return node.measured.height
  if (node.type === 'palace') return PALACE_NODE_HEIGHT
  return DEFAULT_NODE_HEIGHT
}

function nodeWidth(nodeId: string, nodes: Node[]): number {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return DEFAULT_NODE_WIDTH
  if (node.measured?.width) return node.measured.width
  if (node.type === 'palace') return PALACE_NODE_WIDTH
  return DEFAULT_NODE_WIDTH
}

function subtreeHeight(nodeId: string, edges: Edge[], nodes: Node[], gapY: number): number {
  const selfH = nodeHeight(nodeId, nodes)
  const childIds = getChildIds(edges, nodeId)
  if (childIds.length === 0) return selfH
  const childHeights = childIds.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const childrenTotal = childHeights.reduce((sum, h) => sum + h, 0) + (childIds.length - 1) * gapY
  return Math.max(selfH, childrenTotal)
}

// ─── 逻辑图布局（从左向右） ────────────────────────────────────────────────────

interface MindmapNodeMeta {
  depth: number
  branchIndex: number
  /** 思维导图布局中节点所在的一侧；logic 布局不写入（保留原值）。 */
  side?: 'left' | 'right'
}

/**
 * 为根节点的直接子节点分配稳定的 branchIndex（决定分支颜色）。
 * 已有 data.branchIndex 的节点保持不变；新节点取当前最大值 +1。
 * 这样新增/删除节点不会让其余分支的颜色移位。
 */
function assignStableBranchIndexes(childIds: string[], nodes: Node[]): Map<string, number> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const result = new Map<string, number>()
  const used = new Set<number>()
  let maxIdx = -1

  for (const cid of childIds) {
    const bi = nodeById.get(cid)?.data?.branchIndex
    if (typeof bi === 'number' && bi >= 0 && !used.has(bi)) {
      result.set(cid, bi)
      used.add(bi)
      maxIdx = Math.max(maxIdx, bi)
    }
  }
  for (const cid of childIds) {
    if (!result.has(cid)) {
      maxIdx += 1
      result.set(cid, maxIdx)
    }
  }
  return result
}

function layoutLogicSubtree(
  nodeId: string,
  x: number,
  y: number,
  depth: number,
  branchIndex: number,
  nodes: Node[],
  edges: Edge[],
  gapX: number,
  gapY: number,
  positions: Map<string, { x: number; y: number }>,
  handleMap: Map<string, { source: Position; target: Position }>,
  metaMap: Map<string, MindmapNodeMeta>,
): void {
  const selfH = nodeHeight(nodeId, nodes)
  const selfW = nodeWidth(nodeId, nodes)

  positions.set(nodeId, { x, y })
  handleMap.set(nodeId, { source: Position.Right, target: Position.Left })
  metaMap.set(nodeId, { depth, branchIndex })

  const childIds = getChildIdsOrdered(nodes, edges, nodeId)
  if (childIds.length === 0) return

  const childX = x + selfW + gapX
  const childHeights = childIds.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const totalH = childHeights.reduce((s, h) => s + h, 0) + (childIds.length - 1) * gapY
  const centerY = y + selfH / 2
  let curY = centerY - totalH / 2

  const branchIndexOf = depth === 0 ? assignStableBranchIndexes(childIds, nodes) : null

  childIds.forEach((cid, i) => {
    const childH = childHeights[i]!
    const childSelfH = nodeHeight(cid, nodes)
    const childBranch = branchIndexOf ? branchIndexOf.get(cid)! : branchIndex

    layoutLogicSubtree(
      cid,
      childX,
      curY + childH / 2 - childSelfH / 2,
      depth + 1,
      childBranch,
      nodes,
      edges,
      gapX,
      gapY,
      positions,
      handleMap,
      metaMap,
    )
    curY += childH + gapY
  })
}

// ─── 思维导图双向布局 ──────────────────────────────────────────────────────────

function layoutMindmapSide(
  nodeId: string,
  x: number,
  y: number,
  depth: number,
  branchIndex: number,
  direction: 'left' | 'right',
  nodes: Node[],
  edges: Edge[],
  gapX: number,
  gapY: number,
  positions: Map<string, { x: number; y: number }>,
  handleMap: Map<string, { source: Position; target: Position }>,
  metaMap: Map<string, MindmapNodeMeta>,
): void {
  const selfH = nodeHeight(nodeId, nodes)
  const selfW = nodeWidth(nodeId, nodes)

  positions.set(nodeId, { x, y })
  handleMap.set(nodeId, {
    source: direction === 'right' ? Position.Right : Position.Left,
    target: direction === 'right' ? Position.Left : Position.Right,
  })
  metaMap.set(nodeId, { depth, branchIndex, side: direction })

  const childIds = getChildIdsOrdered(nodes, edges, nodeId)
  if (childIds.length === 0) return

  const childX =
    direction === 'right' ? x + selfW + gapX : x - gapX - nodeWidth(childIds[0]!, nodes)

  const childHeights = childIds.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const totalH = childHeights.reduce((s, h) => s + h, 0) + (childIds.length - 1) * gapY
  const centerY = y + selfH / 2
  let curY = centerY - totalH / 2

  childIds.forEach((cid, i) => {
    const childH = childHeights[i]!
    const childSelfH = nodeHeight(cid, nodes)
    const childActualX = direction === 'right' ? childX : x - gapX - nodeWidth(cid, nodes)

    layoutMindmapSide(
      cid,
      childActualX,
      curY + childH / 2 - childSelfH / 2,
      depth + 1,
      branchIndex,
      direction,
      nodes,
      edges,
      gapX,
      gapY,
      positions,
      handleMap,
      metaMap,
    )
    curY += childH + gapY
  })
}

function layoutMindmap(
  rootId: string,
  nodes: Node[],
  edges: Edge[],
  gapX: number,
  gapY: number,
  positions: Map<string, { x: number; y: number }>,
  handleMap: Map<string, { source: Position; target: Position }>,
  metaMap: Map<string, MindmapNodeMeta>,
): void {
  const root = nodes.find((n) => n.id === rootId)
  if (!root) return

  const rootW = nodeWidth(rootId, nodes)
  const rootH = nodeHeight(rootId, nodes)

  positions.set(rootId, { x: root.position.x, y: root.position.y })
  handleMap.set(rootId, { source: Position.Right, target: Position.Left })
  metaMap.set(rootId, { depth: 0, branchIndex: -1 })

  const children = getChildIdsOrdered(nodes, edges, rootId)

  // 分侧持久化在 data.side 中，重新布局时保持不变，避免新增节点导致左右洗牌。
  // 未分侧的新节点分到数量较少的一侧（平局归右），全新导图效果即左右交替。
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const sideOf = new Map<string, 'left' | 'right'>()
  for (const cid of children) {
    const side = nodeById.get(cid)?.data?.side
    if (side === 'left' || side === 'right') sideOf.set(cid, side)
  }
  let rightCount = children.filter((cid) => sideOf.get(cid) === 'right').length
  let leftCount = children.filter((cid) => sideOf.get(cid) === 'left').length
  for (const cid of children) {
    if (sideOf.has(cid)) continue
    const side = rightCount <= leftCount ? 'right' : 'left'
    sideOf.set(cid, side)
    if (side === 'right') rightCount++
    else leftCount++
  }

  const rightChildren = children.filter((cid) => sideOf.get(cid) === 'right')
  const leftChildren = children.filter((cid) => sideOf.get(cid) === 'left')
  const branchIndexOf = assignStableBranchIndexes(children, nodes)

  // 右侧展开
  const rightHeights = rightChildren.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const rightTotalH = rightHeights.reduce((s, h) => s + h, 0) + (rightChildren.length - 1) * gapY
  let curRightY = root.position.y + rootH / 2 - rightTotalH / 2
  rightChildren.forEach((cid, i) => {
    const childH = rightHeights[i]!
    const childSelfH = nodeHeight(cid, nodes)
    layoutMindmapSide(
      cid,
      root.position.x + rootW + gapX,
      curRightY + childH / 2 - childSelfH / 2,
      1,
      branchIndexOf.get(cid)!,
      'right',
      nodes,
      edges,
      gapX,
      gapY,
      positions,
      handleMap,
      metaMap,
    )
    curRightY += childH + gapY
  })

  // 左侧展开
  const leftHeights = leftChildren.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const leftTotalH = leftHeights.reduce((s, h) => s + h, 0) + (leftChildren.length - 1) * gapY
  let curLeftY = root.position.y + rootH / 2 - leftTotalH / 2
  leftChildren.forEach((cid, i) => {
    const childH = leftHeights[i]!
    const childSelfH = nodeHeight(cid, nodes)
    const childSelfW = nodeWidth(cid, nodes)
    layoutMindmapSide(
      cid,
      root.position.x - gapX - childSelfW,
      curLeftY + childH / 2 - childSelfH / 2,
      1,
      branchIndexOf.get(cid)!,
      'left',
      nodes,
      edges,
      gapX,
      gapY,
      positions,
      handleMap,
      metaMap,
    )
    curLeftY += childH + gapY
  })
}

// ─── 公开 API ──────────────────────────────────────────────────────────────────

/**
 * 对整棵树执行布局，返回更新了 position / sourcePosition / targetPosition / data.depth / data.branchIndex 的节点数组。
 * structureType 默认为 'logic'。
 */
export function reflowChildren(
  parentId: string,
  nodes: Node[],
  edges: Edge[],
  offsetX: number,
  gapY: number,
  structureType: 'logic' | 'mindmap' = 'logic',
): Node[] {
  const rootId = findRootId(edges, parentId)
  const root = nodes.find((n) => n.id === rootId)
  if (!root) return nodes

  const positions = new Map<string, { x: number; y: number }>()
  const handleMap = new Map<string, { source: Position; target: Position }>()
  const metaMap = new Map<string, MindmapNodeMeta>()

  const gapX = offsetX - DEFAULT_NODE_WIDTH

  if (structureType === 'mindmap') {
    layoutMindmap(rootId, nodes, edges, gapX, gapY, positions, handleMap, metaMap)
  } else {
    layoutLogicSubtree(
      rootId,
      root.position.x,
      root.position.y,
      0,
      -1,
      nodes,
      edges,
      gapX,
      gapY,
      positions,
      handleMap,
      metaMap,
    )
  }

  return nodes.map((node) => {
    const pos = positions.get(node.id)
    const handles = handleMap.get(node.id)
    const meta = metaMap.get(node.id)
    if (!pos && !handles && !meta) return node
    return {
      ...node,
      ...(pos ? { position: pos } : {}),
      ...(handles ? { sourcePosition: handles.source, targetPosition: handles.target } : {}),
      ...(meta
        ? {
            data: {
              ...node.data,
              depth: meta.depth,
              branchIndex: meta.branchIndex,
              // logic 布局的 meta 不带 side，保留节点原有分侧，切回 mindmap 时仍稳定
              ...(meta.side ? { side: meta.side } : {}),
            },
          }
        : {}),
    }
  })
}

function findRootId(edges: Edge[], startId: string): string {
  let current = startId
  for (;;) {
    const parent = edges.find((e) => e.target === current)
    if (!parent) return current
    current = parent.source
  }
}

export function withNewChild(
  nodes: Node[],
  edges: Edge[],
  parentId: string,
  data: TextNodeData,
  offsetX: number,
  gapY: number,
  structureType: 'logic' | 'mindmap' = 'logic',
): { nodes: Node[]; edges: Edge[]; newNodeId: string } {
  const childId = newId()
  const parent = nodes.find((n) => n.id === parentId)
  if (!parent) return { nodes, edges, newNodeId: childId }

  const child: Node = {
    id: childId,
    type: 'text',
    position: { x: parent.position.x + offsetX, y: parent.position.y },
    data: { ...data, justAdded: true },
  }
  const nextEdges: Edge[] = [
    ...edges,
    {
      id: `e-${parentId}-${childId}`,
      source: parentId,
      target: childId,
      type: 'mindmap',
      className: 'mindmap-edge mindmap-edge--enter',
    },
  ]
  const nextNodes = [...nodes, child]
  const laidOut = reflowChildren(parentId, nextNodes, nextEdges, offsetX, gapY, structureType)
  return { nodes: laidOut, edges: nextEdges, newNodeId: childId }
}

export function withNewSibling(
  nodes: Node[],
  edges: Edge[],
  selectedId: string,
  data: TextNodeData,
  offsetX: number,
  gapY: number,
  structureType: 'logic' | 'mindmap' = 'logic',
): { nodes: Node[]; edges: Edge[] } {
  const parentId = findParentId(edges, selectedId)
  if (!parentId) return { nodes, edges }
  const { nodes: n2, edges: e2 } = withNewChild(
    nodes,
    edges,
    parentId,
    data,
    offsetX,
    gapY,
    structureType,
  )
  return { nodes: n2, edges: e2 }
}

export function deserializeNode(node: Node): Node {
  const descriptor = nodeRegistry.get(node.type!)
  return descriptor ? { ...node, data: descriptor.deserialize(node.data) } : node
}
