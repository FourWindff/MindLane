import type { Edge, Node } from '@xyflow/react'
import { reflowChildren } from '@/shared/lib/mindmapTree'
import { useStyleStore } from '@/features/mindmap/style/styleStore'
import { VISUAL_VARIANTS } from '@/features/mindmap/style/presets'
import type { MindmapLayoutAdapter } from './layoutAdapter'
import type { MindmapStructureType } from '../mindmapLayout'

export class TreeLayoutAdapter implements MindmapLayoutAdapter<MindmapStructureType> {
  layout(nodes: Node[], edges: Edge[], structureType: MindmapStructureType): Node[] {
    const { spacing } = VISUAL_VARIANTS[useStyleStore.getState().visualVariant]
    const targetIds = new Set(edges.map((edge) => edge.target))
    const roots = nodes.filter((node) => !targetIds.has(node.id))
    let result = nodes
    for (const root of roots) {
      result = reflowChildren(root.id, result, edges, spacing.offsetX, spacing.gapY, structureType)
    }
    return result
  }
}
