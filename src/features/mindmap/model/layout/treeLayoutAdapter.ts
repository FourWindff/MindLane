import type { Edge, Node } from '@xyflow/react'
import { reflowChildren } from '@/shared/lib/mindmapTree'
import { DEFAULT_STYLE, VISUAL_VARIANTS } from '@/features/mindmap/style/presets'
import type { VisualVariant } from '@/features/mindmap/style/types'
import type { MindmapLayoutAdapter } from './layoutAdapter'
import type { MindmapStructureType } from '../mindmapLayout'

export class TreeLayoutAdapter implements MindmapLayoutAdapter<MindmapStructureType> {
  layout(
    nodes: Node[],
    edges: Edge[],
    structureType: MindmapStructureType,
    visualVariant: VisualVariant = DEFAULT_STYLE.visualVariant,
  ): Node[] {
    const { spacing } = VISUAL_VARIANTS[visualVariant]
    const targetIds = new Set(edges.map((edge) => edge.target))
    const roots = nodes.filter((node) => !targetIds.has(node.id))
    let result = nodes
    for (const root of roots) {
      result = reflowChildren(root.id, result, edges, spacing.offsetX, spacing.gapY, structureType)
    }
    return result
  }
}
