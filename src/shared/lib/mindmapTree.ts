import { TextNodeData } from '@/features/mindmap/nodes/text'
import { nodeRegistry } from '@/features/mindmap/nodes'
import type { Edge, Node } from '@xyflow/react'

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
      data: { label: '中心主题' },
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

export function getChildIds(edges: Edge[], parentId: string): string[] {
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

export function getChildIdsOrdered(
  nodes: Node[],
  edges: Edge[],
  parentId: string,
): string[] {
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
const H_GAP = 60

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

function subtreeHeight(
  nodeId: string,
  edges: Edge[],
  nodes: Node[],
  gapY: number,
): number {
  const selfH = nodeHeight(nodeId, nodes)
  const childIds = getChildIds(edges, nodeId)
  if (childIds.length === 0) return selfH
  const childHeights = childIds.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const childrenTotal = childHeights.reduce((sum, h) => sum + h, 0) + (childIds.length - 1) * gapY
  return Math.max(selfH, childrenTotal)
}

function layoutSubtree(
  nodeId: string,
  x: number,
  yCenter: number,
  nodes: Node[],
  edges: Edge[],
  _offsetX: number,
  gapY: number,
  positions: Map<string, { x: number; y: number }>,
): void {
  const selfH = nodeHeight(nodeId, nodes)
  const selfW = nodeWidth(nodeId, nodes)
  positions.set(nodeId, { x, y: yCenter - selfH / 2 })

  const childIds = getChildIdsOrdered(nodes, edges, nodeId)
  if (childIds.length === 0) return

  const childX = x + selfW + H_GAP

  const childHeights = childIds.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const totalH = childHeights.reduce((s, h) => s + h, 0) + (childIds.length - 1) * gapY
  let curY = yCenter - totalH / 2

  childIds.forEach((cid, i) => {
    const childCenter = curY + childHeights[i]! / 2
    layoutSubtree(cid, childX, childCenter, nodes, edges, _offsetX, gapY, positions)
    curY += childHeights[i]! + gapY
  })
}

export function reflowChildren(
  parentId: string,
  nodes: Node[],
  edges: Edge[],
  offsetX: number,
  gapY: number,
): Node[] {
  const rootId = findRootId(edges, parentId)
  const root = nodes.find((n) => n.id === rootId)
  if (!root) return nodes

  const rootH = nodeHeight(rootId, nodes)
  const rootCenterY = root.position.y + rootH / 2

  const positions = new Map<string, { x: number; y: number }>()
  layoutSubtree(rootId, root.position.x, rootCenterY, nodes, edges, offsetX, gapY, positions)

  return nodes.map((node) => {
    const pos = positions.get(node.id)
    if (!pos) return node
    return { ...node, position: pos }
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
  const laidOut = reflowChildren(parentId, nextNodes, nextEdges, offsetX, gapY)
  return { nodes: laidOut, edges: nextEdges, newNodeId: childId }
}

export function withNewSibling(
  nodes: Node[],
  edges: Edge[],
  selectedId: string,
  data: TextNodeData,
  offsetX: number,
  gapY: number,
): { nodes: Node[]; edges: Edge[] } {
  const parentId = findParentId(edges, selectedId)
  if (!parentId) return { nodes, edges }
  const { nodes: n2, edges: e2 } = withNewChild(nodes, edges, parentId, data, offsetX, gapY)
  return { nodes: n2, edges: e2 }
}

export function deleteSubtree(
  nodes: Node[],
  edges: Edge[],
  rootId: string,
): { nodes: Node[]; edges: Edge[] } {
  const toRemove = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    toRemove.add(id)
    getChildIds(edges, id).forEach((c) => stack.push(c))
  }
  return {
    nodes: nodes.filter((n) => !toRemove.has(n.id)),
    edges: edges.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target)),
  }
}

export function deserializeNode(node: Node): Node {
  const descriptor = nodeRegistry.get(node.type!)
  return descriptor
    ? { ...node, data: descriptor.deserialize(node.data) }
    : node
}
