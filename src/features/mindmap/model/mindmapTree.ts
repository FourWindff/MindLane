import type { Edge, Node } from '@xyflow/react'
import { createInitialDocument } from '@contracts/mindmapDocument/initial'

// Single source for the pure tree queries and the deterministic layout lives in
// the contracts layer (the document service runs both in the main process).
// Re-exported here so the renderer keeps its existing import surface.
export {
  CHILD_GAP_Y,
  CHILD_OFFSET_X,
  collectDescendantIds,
  collectSubtreeIds,
  findParentId,
  findRootNode,
  getChildIdsOrdered,
  newId,
} from '@contracts/mindmapDocument/tree'
export { layoutInitial, layoutReflow, reflowChildren } from '@contracts/mindmapDocument/layout'
export { defaultNodeSize } from '@contracts/mindmapDocument/nodeSize'

export function createInitialNodes(): Node[] {
  return createInitialDocument().nodes as Node[]
}

export function createInitialEdges(): Edge[] {
  return createInitialDocument().edges as Edge[]
}
