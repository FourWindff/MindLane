/**
 * Editor-side validation (shared by insertFromXml / updateMindmapNode):
 * checks a parsed fragment against the editor's live state for existence,
 * pure-tree and asset-reference validity.
 *
 * A failure throws MindmapXmlError and the code goes back to the AI (PRD 5.4).
 * No failure ever produces a partial mount — the caller must reject the whole thing.
 */

import { MindmapXmlError } from './types.js'
import type { ParsedFragment } from './deserializer.js'

interface EditorValidationContext {
  /** All current editor node ids (including root) */
  nodeIds: Set<string>
  /** Current editor asset id set */
  assetIds: Set<string>
}

function collectNodeIds(fragment: ParsedFragment): Set<string> {
  return new Set(fragment.nodes.map((n) => n.id))
}

function collectAssetRefs(fragment: ParsedFragment): string[] {
  const refs: string[] = []
  for (const node of fragment.nodes) {
    const data = node.data as Record<string, unknown>
    if (typeof data.assetId === 'string' && data.assetId) refs.push(data.assetId)
  }
  return refs
}

/**
 * insertXmlFragment validation: ids in the fragment must not collide with
 * existing editor nodes (a collision = multiple parents/duplicate subtree →
 * tree_invalid); asset references must exist → asset_not_found.
 * `excludeIds`: in whole-replacement scenarios (updateMindmapNode), the replaced
 * node itself and its old subtree are excluded.
 */
export function validateFragmentForInsert(
  fragment: ParsedFragment,
  ctx: EditorValidationContext,
  excludeIds: Set<string> = new Set(),
): void {
  for (const id of collectNodeIds(fragment)) {
    if (ctx.nodeIds.has(id) && !excludeIds.has(id)) {
      throw new MindmapXmlError(
        'tree_invalid',
        `Node id "${id}" already exists in the mindmap (a pure tree forbids duplicate ids; otherwise multiple parents/cycles appear)`,
      )
    }
  }
  for (const assetId of collectAssetRefs(fragment)) {
    if (!ctx.assetIds.has(assetId)) {
      throw new MindmapXmlError(
        'asset_not_found',
        `Reference to a nonexistent image asset "${assetId}" (assets must come from context)`,
      )
    }
  }
}

/**
 * moveMindmapNode validation: target id existence, root is immovable, and the
 * target must not sit inside the moved subtree (cycle).
 */
export function validateMove(
  nodeId: string,
  targetId: string,
  ctx: { nodeIds: Set<string>; childrenOf: Map<string, string[]> },
): void {
  if (nodeId === 'root') {
    throw new MindmapXmlError('tree_invalid', 'root is the mindmap anchor and cannot be moved')
  }
  if (!ctx.nodeIds.has(nodeId)) {
    throw new MindmapXmlError(
      'block_not_found',
      `Node "${nodeId}" does not exist; call readMindmap to locate it again`,
    )
  }
  if (targetId === nodeId) {
    throw new MindmapXmlError('tree_invalid', 'The target node cannot be itself')
  }
  if (!ctx.nodeIds.has(targetId)) {
    throw new MindmapXmlError(
      'block_not_found',
      `Target node "${targetId}" does not exist; call readMindmap to locate it again`,
    )
  }
  // Cycle detection: targetId must not sit inside nodeId's subtree (otherwise nodeId becomes a child of its own descendant)
  const stack = [...(ctx.childrenOf.get(nodeId) ?? [])]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === targetId) {
      throw new MindmapXmlError(
        'tree_invalid',
        `Cannot move a node into its own subtree (this would create a cycle)`,
      )
    }
    if (visited.has(current)) continue
    visited.add(current)
    for (const child of ctx.childrenOf.get(current) ?? []) stack.push(child)
  }
}

/**
 * Build the validation context from nodes/edges/assets (either editor Node[] or a snapshot shape).
 */
export function buildValidationContext(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>,
  assets: Array<{ id: string }>,
): { ctx: EditorValidationContext; childrenOf: Map<string, string[]> } {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const assetIds = new Set(assets.map((a) => a.id))
  const childrenOf = new Map<string, string[]>()
  for (const edge of edges) {
    const list = childrenOf.get(edge.source)
    if (list) list.push(edge.target)
    else childrenOf.set(edge.source, [edge.target])
  }
  return { ctx: { nodeIds, assetIds }, childrenOf }
}
