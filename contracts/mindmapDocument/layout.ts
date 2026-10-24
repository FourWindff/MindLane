/**
 * Deterministic mindmap layout: a pure function over the document value.
 *
 * The main-process document service runs it after every structural change and
 * ships the resulting positions with the versioned state; the renderer never
 * computes a layout of its own. Positions are never persisted — they are a
 * product of the tree and the structure style.
 *
 * This module only imports xyflow *types* (erased at build time), so the
 * Electron main-process bundle never pulls the xyflow runtime in.
 */

import dagre from 'dagre'
import type { MindmapDocumentEdge, MindmapDocumentNode, MindmapStructureType } from './types.js'
import { CHILD_GAP_Y, CHILD_OFFSET_X, getChildIdsOrdered } from './tree.js'
import { defaultNodeSize } from './nodeSize.js'

const RANK_SEPARATION = 260
const NODE_SEPARATION = 24

type Position = 'left' | 'right' | 'top' | 'bottom'

const POSITION = {
  Top: 'top' as const,
  Bottom: 'bottom' as const,
  Left: 'left' as const,
  Right: 'right' as const,
}

/** Initial layout (dagre); used when a whole graph first lands on the canvas. */
export function layoutInitial(
  nodes: MindmapDocumentNode[],
  edges: MindmapDocumentEdge[],
): MindmapDocumentNode[] {
  if (nodes.length === 0) return nodes

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'LR',
    ranksep: RANK_SEPARATION,
    nodesep: NODE_SEPARATION,
    marginx: 0,
    marginy: 0,
  })

  for (const node of nodes) {
    const size = defaultNodeSize(node.type)
    graph.setNode(node.id, {
      width: node.measured?.width ?? size.width,
      height: node.measured?.height ?? size.height,
    })
  }
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(graph)
  return nodes.map((node) => {
    const position = graph.node(node.id)
    if (!position) return node
    return {
      ...node,
      position: {
        x: position.x - position.width / 2,
        y: position.y - position.height / 2,
      },
    }
  })
}

/** Incremental reflow of a forest; node spacing is fixed. */
export function layoutReflow(
  nodes: MindmapDocumentNode[],
  edges: MindmapDocumentEdge[],
  structureType: MindmapStructureType = 'logic',
): MindmapDocumentNode[] {
  const targetIds = new Set(edges.map((edge) => edge.target))
  const roots = nodes.filter((node) => !targetIds.has(node.id))
  let result = nodes
  for (const root of roots) {
    result = reflowChildren(root.id, result, edges, CHILD_OFFSET_X, CHILD_GAP_Y, structureType)
  }
  return result
}

function getChildIds(edges: MindmapDocumentEdge[], parentId: string): string[] {
  return edges.filter((e) => e.source === parentId).map((e) => e.target)
}

function nodeHeight(nodeId: string, nodes: MindmapDocumentNode[]): number {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return defaultNodeSize('text').height
  if (node.measured?.height) return node.measured.height
  return defaultNodeSize(node.type).height
}

function nodeWidth(nodeId: string, nodes: MindmapDocumentNode[]): number {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return defaultNodeSize('text').width
  if (node.measured?.width) return node.measured.width
  return defaultNodeSize(node.type).width
}

function subtreeHeight(
  nodeId: string,
  edges: MindmapDocumentEdge[],
  nodes: MindmapDocumentNode[],
  gapY: number,
): number {
  const selfH = nodeHeight(nodeId, nodes)
  const childIds = getChildIds(edges, nodeId)
  // A collapsed node counts as a leaf: its subtree is left out of sizing and reflows on expand
  if (childIds.length === 0 || isNodeCollapsed(nodes, nodeId)) return selfH
  const childHeights = childIds.map((cid) => subtreeHeight(cid, edges, nodes, gapY))
  const childrenTotal = childHeights.reduce((sum, h) => sum + h, 0) + (childIds.length - 1) * gapY
  return Math.max(selfH, childrenTotal)
}

/** Whether a node is collapsed (a generic display property; expanded by default). */
function isNodeCollapsed(nodes: MindmapDocumentNode[], nodeId: string): boolean {
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
 * Assign a stable branchIndex to a node's direct children (it decides the branch color).
 * Nodes that already carry data.branchIndex keep it; a new node takes the current max +1.
 * Adding or deleting nodes therefore never shifts the colors of the other branches.
 */
function assignStableBranchIndexes(
  childIds: string[],
  nodes: MindmapDocumentNode[],
): Map<string, number> {
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
  nodes: MindmapDocumentNode[],
  edges: MindmapDocumentEdge[],
  gapX: number,
  gapY: number,
  positions: Map<string, { x: number; y: number }>,
  handleMap: Map<string, { source: Position; target: Position }>,
  metaMap: Map<string, MindmapNodeMeta>,
): void {
  const selfH = nodeHeight(nodeId, nodes)
  const selfW = nodeWidth(nodeId, nodes)

  positions.set(nodeId, { x, y })
  handleMap.set(nodeId, { source: POSITION.Right, target: POSITION.Left })
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
  nodes: MindmapDocumentNode[],
  edges: MindmapDocumentEdge[],
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
    source: direction === 'right' ? POSITION.Right : POSITION.Left,
    target: direction === 'right' ? POSITION.Left : POSITION.Right,
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
  nodes: MindmapDocumentNode[],
  edges: MindmapDocumentEdge[],
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
  handleMap.set(rootId, { source: POSITION.Right, target: POSITION.Left })
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
  nodes: MindmapDocumentNode[],
  edges: MindmapDocumentEdge[],
  offsetX: number,
  gapY: number,
  structureType: MindmapStructureType = 'logic',
): MindmapDocumentNode[] {
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

function findRootId(edges: MindmapDocumentEdge[], startId: string): string {
  let current = startId
  for (;;) {
    const parent = edges.find((e) => e.target === current)
    if (!parent) return current
    current = parent.source
  }
}

// Re-exported here so layout consumers do not reach back into the renderer for
// the tree queries the layout itself uses.
export { CHILD_GAP_Y, CHILD_OFFSET_X, getChildIdsOrdered }
