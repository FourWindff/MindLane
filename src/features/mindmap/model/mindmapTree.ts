import { defaultNodeSize } from './layout/nodeSize'
import { findRootIds, getChildIdsOrdered } from '@contracts/mindmapXml/serializer'
import type { Edge, Node, Position as XyflowPosition } from '@xyflow/react'

/**
 * Position values used by the layout engine (handle / source / target sides).
 * Mirrors xyflow's Position enum with identical string values, so this shared
 * module only needs the xyflow *types* (erased at build time) and never pulls
 * the xyflow runtime into the Electron main-process bundle.
 */
export type Position = XyflowPosition
export const Position = {
  Top: 'top' as Position,
  Bottom: 'bottom' as Position,
  Left: 'left' as Position,
  Right: 'right' as Position,
}

export const CHILD_OFFSET_X = 200
export const CHILD_GAP_Y = 12

export { newId } from '@contracts/ids'

export function createInitialNodes(): Node[] {
  return [
    {
      id: 'root',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { label: 'Central Topic', depth: 0, branchIndex: -1 },
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

/**
 * Collect every descendant id of a subtree (excluding rootId itself).
 * Used when rendering a collapsed node to hide all of its descendants while the collapsed
 * node itself stays visible (its expand button remains).
 */
export function collectDescendantIds(edges: Edge[], rootId: string): Set<string> {
  const ids = collectSubtreeIds(edges, rootId)
  ids.delete(rootId)
  return ids
}

export { getChildIdsOrdered }

export function findRootNode(nodes: Node[], edges: Edge[]): Node | undefined {
  const rootId = findRootIds(nodes, edges)[0]
  return nodes.find((n) => n.id === rootId)
}

function nodeHeight(nodeId: string, nodes: Node[]): number {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return defaultNodeSize('text').height
  if (node.measured?.height) return node.measured.height
  return defaultNodeSize(node.type).height
}

function nodeWidth(nodeId: string, nodes: Node[]): number {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return defaultNodeSize('text').width
  if (node.measured?.width) return node.measured.width
  return defaultNodeSize(node.type).width
}

function subtreeHeight(nodeId: string, edges: Edge[], nodes: Node[], gapY: number): number {
  const selfH = nodeHeight(nodeId, nodes)
  const childIds = getChildIds(edges, nodeId)
  // A collapsed node counts as a leaf (PRD 04): its subtree is left out of sizing and reflows on expand
  if (childIds.length === 0 || isNodeCollapsed(nodes, nodeId)) return selfH
  const childHeights = childIds.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const childrenTotal = childHeights.reduce((sum, h) => sum + h, 0) + (childIds.length - 1) * gapY
  return Math.max(selfH, childrenTotal)
}

/** Whether a node is collapsed (a generic display property; expanded by default). */
function isNodeCollapsed(nodes: Node[], nodeId: string): boolean {
  return nodes.find((n) => n.id === nodeId)?.data?.collapsed === true
}

// ─── Logic layout (left to right) ────────────────────────────────────────────────────

interface MindmapNodeMeta {
  depth: number
  branchIndex: number
  /** Which side the node sits on in mindmap layout; logic layout does not write it (the old value is kept). */
  side?: 'left' | 'right'
}

/**
 * Assign a stable branchIndex to the root's direct children (it decides the branch color).
 * Nodes that already carry data.branchIndex keep it; a new node takes the current max +1.
 * Adding or deleting nodes therefore never shifts the colors of the other branches.
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
  if (childIds.length === 0 || isNodeCollapsed(nodes, nodeId)) return

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

// ─── Bilateral mindmap layout ──────────────────────────────────────────────────────────

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
  if (childIds.length === 0 || isNodeCollapsed(nodes, nodeId)) return

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

  const rootData = root.data as {
    collapsed?: boolean
    leftCollapsed?: boolean
    rightCollapsed?: boolean
  }
  const children = getChildIdsOrdered(nodes, edges, rootId)
  // Root whole-map collapse: only the root stays (its position/handles are set above)
  if (rootData.collapsed === true) return

  // The side is persisted in data.side and survives a reflow, so adding nodes never
  // reshuffles left and right. A new node with no side goes to the smaller side (ties go
  // right), which makes a brand-new mindmap alternate left/right.
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

  // Both branches run the same stacking loop; they only differ in the child set, the
  // side-collapse flag and how a child's x is derived from the root (right grows away from
  // the root, left grows back by the child's own width).
  const branches: {
    children: string[]
    collapsed: boolean
    side: 'left' | 'right'
    xOf: (childId: string) => number
  }[] = [
    {
      children: rightChildren,
      collapsed: rootData.rightCollapsed === true,
      side: 'right',
      xOf: () => root.position.x + rootW + gapX,
    },
    {
      children: leftChildren,
      collapsed: rootData.leftCollapsed === true,
      side: 'left',
      xOf: (cid) => root.position.x - gapX - nodeWidth(cid, nodes),
    },
  ]

  // A side-collapsed branch is skipped entirely; its nodes keep stale positions and are hidden
  // by the render layer.
  for (const branch of branches) {
    if (branch.collapsed) continue

    const heights = branch.children.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
    const totalH = heights.reduce((s, h) => s + h, 0) + (branch.children.length - 1) * gapY
    let curY = root.position.y + rootH / 2 - totalH / 2

    branch.children.forEach((cid, i) => {
      const childH = heights[i]!
      const childSelfH = nodeHeight(cid, nodes)
      layoutMindmapSide(
        cid,
        branch.xOf(cid),
        curY + childH / 2 - childSelfH / 2,
        1,
        branchIndexOf.get(cid)!,
        branch.side,
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
}

// ─── Public API ──────────────────────────────────────────────────────────────────

/**
 * Lay out the whole tree and return the node array with position / sourcePosition /
 * targetPosition / data.depth / data.branchIndex updated.
 * structureType defaults to 'logic'.
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

  const gapX = offsetX - defaultNodeSize('text').width

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
              // Logic-layout meta carries no side, so the node keeps its existing side and stays
              // stable when switching back to mindmap
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
