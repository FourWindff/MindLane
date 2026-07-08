import type { Edge, Node } from '@xyflow/react'
import { reflowChildren, CHILD_OFFSET_X, CHILD_GAP_Y } from '@/shared/lib/mindmapTree'

export type MindmapStructureType = 'logic' | 'mindmap'

/**
 * 对整片森林重新布局。依次对每个根节点调用 `reflowChildren`，
 * 保证新增/删除/移动节点后结构保持一致。
 */
export function layoutForest(
  nodes: Node[],
  edges: Edge[],
  structureType: MindmapStructureType = 'logic',
): Node[] {
  const targetIds = new Set(edges.map((e) => e.target))
  const roots = nodes.filter((n) => !targetIds.has(n.id))
  let result = nodes
  for (const root of roots) {
    result = reflowChildren(root.id, result, edges, CHILD_OFFSET_X, CHILD_GAP_Y, structureType)
  }
  return result
}
