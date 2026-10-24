import { planPalacePlaceholder } from '@contracts/mindmapDocument/palace'
import type { MindmapDocumentEdge, MindmapDocumentNode } from '@contracts/mindmapDocument/types'
import type { MindmapEditor } from './editor'

/**
 * The manual palace run's placeholder (CONTEXT.md "Deterministic Landing"): a
 * progress palace in the landing slot whose children are the selected nodes, so
 * the user sees where the palace is going while the subgraph works.
 *
 * Placement and rewiring are the shared landing plan (the AI trigger uses the
 * same rules in the main process); this function only adds the renderer's own
 * run markers and sends the commands.
 */
export function insertPalacePlaceholder(
  editor: MindmapEditor,
  sourceNodeIds: string[],
): { nodeId: string } {
  const state = editor.getState()
  const plan = planPalacePlaceholder(
    {
      nodes: state.nodes as MindmapDocumentNode[],
      edges: state.edges as MindmapDocumentEdge[],
    },
    sourceNodeIds,
  )
  for (const nodeId of sourceNodeIds) editor.setNodeFlag(nodeId, 'processing', true)
  editor.batch(plan.commands)
  return { nodeId: plan.nodeId }
}
