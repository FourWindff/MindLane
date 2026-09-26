import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import { CHILD_GAP_Y, CHILD_OFFSET_X, reflowChildren } from '@/shared/lib/mindmapTree'
import { defaultNodeSize } from '@/shared/lib/nodeSize'

type MindmapStructureType = 'logic' | 'mindmap'

interface InitialLayoutOptions {
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

/** Initial layout (dagre); used when a whole graph first lands on the canvas. */
export function layoutInitial(
  nodes: Node[],
  edges: Edge[],
  options: InitialLayoutOptions = {},
): Node[] {
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
        x: position.x - position.width / 2 + resolved.rootX,
        y: position.y - position.height / 2 + resolved.rootY,
      },
    }
  })
}

/** Incremental reflow of a forest; node spacing is fixed (the visual variant no longer affects layout). */
export function layoutReflow(
  nodes: Node[],
  edges: Edge[],
  structureType: MindmapStructureType = 'logic',
): Node[] {
  const targetIds = new Set(edges.map((edge) => edge.target))
  const roots = nodes.filter((node) => !targetIds.has(node.id))
  let result = nodes
  for (const root of roots) {
    result = reflowChildren(root.id, result, edges, CHILD_OFFSET_X, CHILD_GAP_Y, structureType)
  }
  return result
}
