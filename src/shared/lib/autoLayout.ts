import dagre from 'dagre'
import type { Node, Edge } from '@xyflow/react'

interface LayoutOptions {
  horizontalGap: number
  verticalGap: number
  rootX: number
  rootY: number
  direction: 'LR' | 'TB'
}

const DEFAULT_OPTIONS: LayoutOptions = {
  horizontalGap: 260,
  verticalGap: 24,
  rootX: 0,
  rootY: 0,
  direction: 'LR',
}

const DEFAULT_NODE_W = 160
const DEFAULT_NODE_H = 48

export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  options: Partial<LayoutOptions> = {},
): Node[] {
  if (nodes.length === 0) return nodes

  const opts = { ...DEFAULT_OPTIONS, ...options }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: opts.direction,
    ranksep: opts.horizontalGap,
    nodesep: opts.verticalGap,
    marginx: 0,
    marginy: 0,
  })

  for (const node of nodes) {
    g.setNode(node.id, {
      width: node.measured?.width ?? DEFAULT_NODE_W,
      height: node.measured?.height ?? DEFAULT_NODE_H,
    })
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    return {
      ...node,
      position: {
        x: pos.x - pos.width / 2 + opts.rootX,
        y: pos.y - pos.height / 2 + opts.rootY,
      },
    }
  })
}
