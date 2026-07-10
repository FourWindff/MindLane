import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import type { MindmapLayoutAdapter } from './layoutAdapter'

export interface InitialLayoutOptions {
  horizontalGap?: number
  verticalGap?: number
  rootX?: number
  rootY?: number
  direction?: 'LR' | 'TB'
}

const DEFAULT_OPTIONS = {
  horizontalGap: 260,
  verticalGap: 24,
  rootX: 0,
  rootY: 0,
  direction: 'LR' as const,
}
const DEFAULT_NODE_WIDTH = 160
const DEFAULT_NODE_HEIGHT = 48

export class DagreLayoutAdapter implements MindmapLayoutAdapter<InitialLayoutOptions> {
  layout(nodes: Node[], edges: Edge[], options: InitialLayoutOptions = {}): Node[] {
    if (nodes.length === 0) return nodes

    const resolved = { ...DEFAULT_OPTIONS, ...options }
    const graph = new dagre.graphlib.Graph()
    graph.setDefaultEdgeLabel(() => ({}))
    graph.setGraph({
      rankdir: resolved.direction,
      ranksep: resolved.horizontalGap,
      nodesep: resolved.verticalGap,
      marginx: 0,
      marginy: 0,
    })

    for (const node of nodes) {
      graph.setNode(node.id, {
        width: node.measured?.width ?? DEFAULT_NODE_WIDTH,
        height: node.measured?.height ?? DEFAULT_NODE_HEIGHT,
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
          x: position.x - position.width / 2 + resolved.rootX,
          y: position.y - position.height / 2 + resolved.rootY,
        },
      }
    })
  }
}
