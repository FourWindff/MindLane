/**
 * Fragment landing plans: an XML fragment plus a document snapshot → the
 * serializable commands that land it.
 *
 * Pure: no DOM, no Electron, no host state. The renderer's editor and the
 * main-process write service both call these, so "validate then land" has one
 * implementation and the two hosts cannot drift apart.
 *
 * A plan throws `MindmapXmlError` when the fragment cannot land; the caller
 * passes the code back to the model unchanged.
 */

import { MindmapXmlError } from '../mindmapXml/types.js'
import type { ParsedFragment } from '../mindmapXml/deserializer.js'
import {
  buildValidationContext,
  validateFragmentForInsert,
  validateMove,
} from '../mindmapXml/validate.js'
import { layoutInitial } from './layout.js'
import { defaultNodeSize } from './nodeSize.js'
import { computeEnterDelays } from './cascade.js'
import { CHILD_GAP_Y, CHILD_OFFSET_X, findParentId, findRootNode } from './tree.js'
import type { MindmapDocument, MindmapDocumentNode } from './types.js'
import type { MindmapWireCommand } from './wire.js'

/** Anchor positions the unified write entry accepts (`insertXmlFragment`). */
export type FragmentInsertPosition = 'root' | 'child' | 'after' | 'before'

export interface FragmentInsertOptions {
  /** Anchor node id: the parent for root/child, the sibling for after/before. */
  targetId?: string
  position?: FragmentInsertPosition
  /**
   * Selection fallback of the renderer's own writes. The main process has no
   * selection, so an AI write without `targetId` lands under the root.
   */
  selectedId?: string
}

/** An asset reference is all the landing rules need; the bytes stay with the caller. */
export interface LandingAsset {
  id: string
}

function fragmentDocument(document: MindmapDocument): {
  nodes: MindmapDocumentNode[]
  edges: MindmapDocument['edges']
} {
  return { nodes: document.nodes, edges: document.edges }
}

/** The implicit parent of a fragment: explicit anchor → selection → root anchor. */
function resolveParentId(
  document: MindmapDocument,
  targetId: string | undefined,
  selectedId: string | undefined,
): string {
  const parentId =
    targetId ??
    selectedId ??
    findRootNode(document.nodes, document.edges)?.id ??
    document.nodes[0]?.id
  if (!parentId) {
    throw new MindmapXmlError(
      'block_not_found',
      'The mindmap has no node to attach the fragment to',
    )
  }
  return parentId
}

/**
 * Land a fragment under `parentId`, aligned to the anchor point: the fragment's
 * own layout runs first (dagre), then it is translated so its first root sits at
 * the anchor. The cascade delays ride along as command payload.
 */
function planAttachedFragment(
  fragment: ParsedFragment,
  parentId: string,
  anchorX: number,
  anchorY: number,
): MindmapWireCommand[] {
  if (fragment.rootIds.length === 0) {
    throw new MindmapXmlError('tree_invalid', 'The fragment has no root node to attach')
  }
  const laidOut = layoutInitial(fragment.nodes as MindmapDocumentNode[], fragment.edges)
  const firstRoot = laidOut.find((node) => node.id === fragment.rootIds[0])
  if (!firstRoot) {
    throw new MindmapXmlError('tree_invalid', 'The fragment root node is missing from the layout')
  }
  const offsetX = anchorX - firstRoot.position.x
  const offsetY = anchorY - firstRoot.position.y
  const enterDelays = computeEnterDelays(fragment.rootIds, laidOut, fragment.edges)

  const commands: MindmapWireCommand[] = laidOut.map((node) => ({
    type: 'addNode',
    node: {
      ...node,
      position: { x: node.position.x + offsetX, y: node.position.y + offsetY },
      data: {
        ...node.data,
        justAdded: true,
        // Always written (including 0): cascadeDelay present = this node came
        // from an agent write path; the view tells manual inserts apart from it.
        cascadeDelay: enterDelays.get(node.id) ?? 0,
      },
    },
  }))
  for (const edge of fragment.edges) {
    commands.push({
      type: 'addEdge',
      edge: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type ?? 'mindmap',
        className: 'mindmap-edge mindmap-edge--enter',
      },
    })
  }
  for (const rootId of fragment.rootIds) {
    commands.push({
      type: 'addEdge',
      edge: {
        id: `e-${parentId}-${rootId}`,
        source: parentId,
        target: rootId,
        type: 'mindmap',
        className: 'mindmap-edge mindmap-edge--enter',
      },
    })
  }
  return commands
}

/**
 * `insertXmlFragment`: validate the fragment against the document, then attach
 * it at the requested position. Sibling positions (after/before) attach under
 * the anchor's parent, vertically aligned above/below the anchor sibling.
 */
export function planFragmentInsert(
  fragment: ParsedFragment,
  document: MindmapDocument,
  assets: LandingAsset[],
  options: FragmentInsertOptions = {},
): MindmapWireCommand[] {
  const { nodes, edges } = fragmentDocument(document)
  const { ctx } = buildValidationContext(nodes, edges, assets)
  validateFragmentForInsert(fragment, ctx)

  const position = options.position ?? 'child'
  if ((position === 'after' || position === 'before') && !options.targetId?.trim()) {
    throw new MindmapXmlError(
      'block_not_found',
      `Inserting at position "${position}" requires an anchor node`,
    )
  }
  if (position !== 'root' && options.targetId && !ctx.nodeIds.has(options.targetId)) {
    throw new MindmapXmlError('block_not_found', `Anchor node "${options.targetId}" does not exist`)
  }

  if (position === 'after' || position === 'before') {
    const siblingId = options.targetId!
    const sibling = nodes.find((node) => node.id === siblingId)!
    const parentId = findParentId(edges, siblingId) ?? findRootNode(nodes, edges)?.id
    const parent = parentId ? nodes.find((node) => node.id === parentId) : undefined
    if (!parentId || !parent) {
      throw new MindmapXmlError(
        'block_not_found',
        `Cannot determine the parent of anchor node "${siblingId}"`,
      )
    }
    const siblingHeight = sibling.measured?.height ?? defaultNodeSize(sibling.type).height
    const firstHeight = defaultNodeSize(fragment.nodes[0]?.type ?? 'text').height
    const anchorX = parent.position.x + CHILD_OFFSET_X
    const anchorY =
      position === 'before'
        ? sibling.position.y - CHILD_GAP_Y - firstHeight
        : sibling.position.y + siblingHeight + CHILD_GAP_Y
    return planAttachedFragment(fragment, parentId, anchorX, anchorY)
  }

  const parentId =
    position === 'root'
      ? (nodes.find((node) => node.id === 'root')?.id ??
        resolveParentId(document, undefined, undefined))
      : resolveParentId(document, options.targetId, options.selectedId)
  const parent = nodes.find((node) => node.id === parentId)
  if (!parent) {
    throw new MindmapXmlError('block_not_found', `Anchor node "${parentId}" does not exist`)
  }
  return planAttachedFragment(
    fragment,
    parentId,
    parent.position.x + CHILD_OFFSET_X,
    parent.position.y,
  )
}

/**
 * `updateMindmapNode`: replace a node (with its whole subtree) from a single
 * root `<node>`. The old parent edge, the node's own position and the edge
 * order are preserved, so a text/content change does not reshuffle the map.
 */
export function planNodeReplacement(
  fragment: ParsedFragment,
  document: MindmapDocument,
  assets: LandingAsset[],
): MindmapWireCommand[] {
  if (fragment.rootIds.length !== 1) {
    throw new MindmapXmlError(
      'tree_invalid',
      'updateMindmapNode must provide exactly one root <node> (including its subtree)',
    )
  }
  const nodeId = fragment.rootIds[0]!
  if (nodeId === 'root') {
    throw new MindmapXmlError('tree_invalid', 'root is the mindmap anchor and cannot be replaced')
  }
  const { nodes, edges } = fragmentDocument(document)
  const oldNode = nodes.find((node) => node.id === nodeId)
  if (!oldNode) {
    throw new MindmapXmlError(
      'block_not_found',
      `Node "${nodeId}" does not exist; call readMindmap to locate it again`,
    )
  }
  const { ctx } = buildValidationContext(nodes, edges, assets)
  validateFragmentForInsert(fragment, ctx, new Set([nodeId]))

  const oldParentId = findParentId(edges, nodeId)
  const oldEdgeIndex = edges.findIndex((edge) => edge.target === nodeId)
  const enterDelays = computeEnterDelays([nodeId], fragment.nodes, fragment.edges)

  const commands: MindmapWireCommand[] = [{ type: 'deleteSubtree', rootId: nodeId }]
  for (const node of fragment.nodes) {
    commands.push({
      type: 'addNode',
      node: {
        ...node,
        // The replacement root keeps its old position so the map does not jump.
        position: node.id === nodeId ? oldNode.position : node.position,
        data: { ...node.data, justAdded: true, cascadeDelay: enterDelays.get(node.id) ?? 0 },
      },
    })
  }
  if (oldParentId) {
    commands.push({
      type: 'addEdge',
      edge: {
        id: `e-${oldParentId}-${nodeId}`,
        source: oldParentId,
        target: nodeId,
        type: 'mindmap',
        className: 'mindmap-edge mindmap-edge--enter',
      },
      ...(oldEdgeIndex >= 0 ? { index: oldEdgeIndex } : {}),
    })
  }
  for (const edge of fragment.edges) {
    commands.push({
      type: 'addEdge',
      edge: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type ?? 'mindmap',
        className: 'mindmap-edge mindmap-edge--enter',
      },
    })
  }
  return commands
}

export type MovePosition = 'child' | 'after' | 'before'

/**
 * `moveMindmapNode`: detach the subtree and re-attach it (one undo restores
 * everything). after/before align the node above/below its new sibling so the
 * layout's y-ordering keeps the requested slot. A move that cannot change
 * anything produces no commands.
 */
export function planNodeMove(
  document: MindmapDocument,
  nodeId: string,
  targetId: string,
  position: MovePosition = 'child',
): MindmapWireCommand[] {
  const { nodes, edges } = fragmentDocument(document)
  const { ctx, childrenOf } = buildValidationContext(nodes, edges, [])
  validateMove(nodeId, targetId, { nodeIds: ctx.nodeIds, childrenOf })

  const oldParentId = findParentId(edges, nodeId)
  const newParentId =
    position === 'child'
      ? targetId
      : (findParentId(edges, targetId) ?? findRootNode(nodes, edges)?.id)
  if (!newParentId || newParentId === nodeId) return []
  if (position === 'child' && newParentId === oldParentId) return []

  const commands: MindmapWireCommand[] = []
  const incomingEdge = edges.find((edge) => edge.target === nodeId)
  if (incomingEdge) commands.push({ type: 'removeEdge', edgeId: incomingEdge.id })

  if (position !== 'child' && oldParentId === newParentId) {
    const sibling = nodes.find((node) => node.id === targetId)
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (sibling && node) {
      const siblingHeight = sibling.measured?.height ?? defaultNodeSize(sibling.type).height
      const nodeHeight = node.measured?.height ?? defaultNodeSize(node.type).height
      const alignY =
        position === 'before'
          ? sibling.position.y - CHILD_GAP_Y - nodeHeight
          : sibling.position.y + siblingHeight + CHILD_GAP_Y
      commands.push({ type: 'moveNode', nodeId, position: { x: node.position.x, y: alignY } })
    }
  }

  commands.push({
    type: 'addEdge',
    edge: {
      id: `e-${newParentId}-${nodeId}`,
      source: newParentId,
      target: nodeId,
      type: 'mindmap',
      className: 'mindmap-edge',
    },
  })
  return commands
}

/**
 * `deleteMindmapNode`: delete the node with its subtree. A missing node is an
 * error (not a silent no-op) so the model gets a real reason to re-read the map.
 */
export function planNodeDeletion(document: MindmapDocument, nodeId: string): MindmapWireCommand[] {
  if (nodeId === 'root') {
    throw new MindmapXmlError('tree_invalid', 'root is the mindmap anchor and cannot be deleted')
  }
  if (!document.nodes.some((node) => node.id === nodeId)) {
    throw new MindmapXmlError(
      'block_not_found',
      `Node "${nodeId}" does not exist; call readMindmap to locate it again`,
    )
  }
  return [{ type: 'deleteSubtree', rootId: nodeId }]
}
