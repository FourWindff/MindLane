/**
 * Tree-based auto layout for mind maps.
 * Arranges nodes in a left-to-right tree layout using edges to determine parent-child.
 */
import type { Node, Edge } from '@xyflow/react'

interface LayoutOptions {
  horizontalGap: number
  verticalGap: number
  rootX: number
  rootY: number
}

const DEFAULT_OPTIONS: LayoutOptions = {
  horizontalGap: 260,
  verticalGap: 24,
  rootX: 0,
  rootY: 0,
}

interface TreeNode {
  id: string
  children: TreeNode[]
  subtreeHeight: number
}

function buildTree(
  rootId: string,
  childMap: Map<string, string[]>,
  nodeWidths: Map<string, number>,
  gapY: number,
): TreeNode {
  const childIds = childMap.get(rootId) ?? []
  const children = childIds.map((cid) => buildTree(cid, childMap, nodeWidths, gapY))

  const childrenTotalHeight = children.reduce(
    (sum, c) => sum + c.subtreeHeight,
    0,
  )
  const childrenGaps = Math.max(0, children.length - 1) * gapY
  const subtreeHeight = Math.max(
    50,
    childrenTotalHeight + childrenGaps,
  )

  return { id: rootId, children, subtreeHeight }
}

function assignPositions(
  tree: TreeNode,
  x: number,
  yCenter: number,
  gapX: number,
  gapY: number,
  positions: Map<string, { x: number; y: number }>,
): void {
  positions.set(tree.id, { x, y: yCenter })

  if (tree.children.length === 0) return

  const totalHeight = tree.children.reduce((s, c) => s + c.subtreeHeight, 0) +
    (tree.children.length - 1) * gapY

  let currentY = yCenter - totalHeight / 2

  for (const child of tree.children) {
    const childCenter = currentY + child.subtreeHeight / 2
    assignPositions(child, x + gapX, childCenter, gapX, gapY, positions)
    currentY += child.subtreeHeight + gapY
  }
}

function findRoots(nodes: Node[], edges: Edge[]): string[] {
  const targets = new Set(edges.map((e) => e.target))
  const roots = nodes
    .filter((n) => !targets.has(n.id))
    .map((n) => n.id)
  return roots.length > 0 ? roots : nodes.length > 0 ? [nodes[0]!.id] : []
}

export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  options: Partial<LayoutOptions> = {},
): Node[] {
  if (nodes.length === 0) return nodes

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const childMap = new Map<string, string[]>()
  const parentMap = new Map<string, string>()

  for (const edge of edges) {
    const children = childMap.get(edge.source)
    if (children) {
      children.push(edge.target)
    } else {
      childMap.set(edge.source, [edge.target])
    }
    parentMap.set(edge.target, edge.source)
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  for (const [, children] of childMap) {
    children.sort((a, b) => {
      const na = nodeMap.get(a)
      const nb = nodeMap.get(b)
      return (na?.position.y ?? 0) - (nb?.position.y ?? 0)
    })
  }

  const roots = findRoots(nodes, edges)
  const positions = new Map<string, { x: number; y: number }>()

  const nodeWidths = new Map<string, number>()
  for (const n of nodes) {
    nodeWidths.set(n.id, n.measured?.width ?? 160)
  }

  let globalY = opts.rootY
  for (const rootId of roots) {
    const tree = buildTree(rootId, childMap, nodeWidths, opts.verticalGap)
    assignPositions(tree, opts.rootX, globalY, opts.horizontalGap, opts.verticalGap, positions)
    globalY += tree.subtreeHeight + opts.verticalGap * 2
  }

  return nodes.map((n) => {
    const pos = positions.get(n.id)
    if (!pos) return n
    return { ...n, position: pos }
  })
}
