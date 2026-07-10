import type { Edge, Node } from '@xyflow/react'
import { CHILD_GAP_Y, CHILD_OFFSET_X, reflowChildren } from '@/shared/lib/mindmapTree'
import type { MindmapLayoutAdapter } from './layoutAdapter'
import type { MindmapStructureType } from '../mindmapLayout'

export class TreeLayoutAdapter implements MindmapLayoutAdapter<MindmapStructureType> {
  layout(nodes: Node[], edges: Edge[], structureType: MindmapStructureType): Node[] {
    const targetIds = new Set(edges.map((edge) => edge.target))
    const roots = nodes.filter((node) => !targetIds.has(node.id))
    let result = nodes
    for (const root of roots) {
      result = reflowChildren(root.id, result, edges, CHILD_OFFSET_X, CHILD_GAP_Y, structureType)
    }
    return result
  }
}
