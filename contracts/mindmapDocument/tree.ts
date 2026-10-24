/**
 * Pure tree helpers shared by the document commands and the renderer layout.
 *
 * Kept in the contracts layer so the command semantics (delete a subtree, land
 * an edge) have exactly one implementation regardless of which process applies
 * them. The layout math itself stays in the mindmap feature; only the tree/
 * graph queries live here.
 */

import { findRootIds, getChildIdsOrdered } from '../mindmapXml/serializer.js'
import type { MindmapXmlEdge, MindmapXmlNode } from '../mindmapXml/types.js'

export { newId } from '../ids.js'
export { getChildIdsOrdered }

export const CHILD_OFFSET_X = 200
export const CHILD_GAP_Y = 12

/** The parent of a node under the pure-tree invariant (at most one incoming edge). */
export function findParentId(edges: MindmapXmlEdge[], nodeId: string): string | null {
  const edge = edges.find((candidate) => candidate.target === nodeId)
  return edge?.source ?? null
}

/** Every node id in the subtree rooted at `rootId`, including the root itself. */
export function collectSubtreeIds(edges: MindmapXmlEdge[], rootId: string): Set<string> {
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    ids.add(id)
    for (const edge of edges) {
      if (edge.source === id) stack.push(edge.target)
    }
  }
  return ids
}

/** Every descendant id of a subtree, excluding `rootId` itself (collapse hiding). */
export function collectDescendantIds(edges: MindmapXmlEdge[], rootId: string): Set<string> {
  const ids = collectSubtreeIds(edges, rootId)
  ids.delete(rootId)
  return ids
}

export function findRootNode(
  nodes: MindmapXmlNode[],
  edges: MindmapXmlEdge[],
): MindmapXmlNode | undefined {
  const rootId = findRootIds(nodes, edges)[0]
  return nodes.find((node) => node.id === rootId)
}
