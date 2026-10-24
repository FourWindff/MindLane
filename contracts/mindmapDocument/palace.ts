/**
 * Deterministic palace landing plans (CONTEXT.md "Deterministic Landing").
 *
 * The palace payload → XML is serialized by code; these plans decide where the
 * landed palace goes and how the selection is rewired, so the manual trigger
 * (renderer placeholder) and the AI trigger (subgraph close-out) share one
 * placement rule. Pure: no DOM, no Electron.
 */

import { MindmapXmlError } from '../mindmapXml/types.js'
import type { ParsedFragment } from '../mindmapXml/deserializer.js'
import { CHILD_OFFSET_X, findParentId, newId } from './tree.js'
import type { MindmapDocument } from './types.js'
import type { MindmapWireCommand } from './wire.js'

const PALACE_TYPE = 'palace'
const PLACEHOLDER_LABEL = 'Generating…'

/** Where a palace lands: under the first source node's parent, at that node's slot. */
export interface PalacePlacement {
  parentId: string
  position: { x: number; y: number }
}

/**
 * Placement rule: the palace takes the slot of the first source node (so the
 * selection moves under it); with no source node it becomes a new child of the
 * root anchor.
 */
export function resolvePalacePlacement(
  document: MindmapDocument,
  sourceNodeIds: string[],
): PalacePlacement {
  const firstSourceId = sourceNodeIds[0]
  const firstSource = firstSourceId
    ? document.nodes.find((node) => node.id === firstSourceId)
    : undefined
  const parentId = (firstSource ? findParentId(document.edges, firstSource.id) : null) ?? 'root'
  if (firstSource) return { parentId, position: firstSource.position }
  const parentNode = document.nodes.find((node) => node.id === parentId)
  return {
    parentId,
    position: {
      x: (parentNode?.position.x ?? 0) + CHILD_OFFSET_X,
      y: parentNode?.position.y ?? 0,
    },
  }
}

/**
 * Rewire the selection under `palaceId`: every live, non-root source node gets
 * an edge from the palace and keeps its subtree; the incoming edges the sources
 * had are replaced (whichever parent they had), so the pure-tree invariant
 * holds even when the selection spans several parents.
 */
function planRewireSelection(
  document: MindmapDocument,
  palaceId: string,
  sourceNodeIds: string[],
): MindmapWireCommand[] {
  const live = new Set(document.nodes.map((node) => node.id))
  const sources = new Set(sourceNodeIds.filter((id) => id !== 'root' && live.has(id)))
  const commands: MindmapWireCommand[] = [...sources].map((nodeId) => ({
    type: 'addEdge',
    edge: {
      id: `e-${palaceId}-${nodeId}`,
      source: palaceId,
      target: nodeId,
      type: 'mindmap',
      className: 'mindmap-edge',
    },
  }))
  for (const edge of document.edges) {
    if (sources.has(edge.target)) commands.push({ type: 'removeEdge', edgeId: edge.id })
  }
  return commands
}

/** The manual trigger's placeholder: a progress palace that can be stopped and resumed. */
export interface PalacePlaceholderPlan {
  nodeId: string
  commands: MindmapWireCommand[]
}

/**
 * Insert the manual run's placeholder palace: a progress node in the landing
 * slot whose children are the selected nodes. The final landing updates this
 * node in place (it is identified by its id, not by its transient run flags).
 */
export function planPalacePlaceholder(
  document: MindmapDocument,
  sourceNodeIds: string[],
): PalacePlaceholderPlan {
  const palaceId = newId()
  const { parentId, position } = resolvePalacePlacement(document, sourceNodeIds)
  return {
    nodeId: palaceId,
    commands: [
      {
        type: 'addNode',
        node: {
          id: palaceId,
          type: PALACE_TYPE,
          position,
          data: {
            label: PLACEHOLDER_LABEL,
            imageUrl: '',
            stations: [],
            sourceNodeIds,
            generating: true,
          },
        },
        edge: {
          id: `e-${parentId}-${palaceId}`,
          source: parentId,
          target: palaceId,
          type: 'mindmap',
          className: 'mindmap-edge',
        },
      },
      ...planRewireSelection(document, palaceId, sourceNodeIds),
    ],
  }
}

/** The landed palace: what the document keeps of the generated payload. */
export interface PalaceLandingPlan {
  commands: MindmapWireCommand[]
  nodeId: string
  /** True: the manual run's placeholder was updated in place; false: a new node was created. */
  updatedPlaceholder: boolean
  sourceNodeIds: string[]
}

/**
 * Land the palace fragment.
 *
 * `placeholderNodeId` (manual run) updates that node in place — the placeholder's
 * routing already points the selection under it. Without it (AI trigger) the
 * palace becomes a new node in the landing slot and the selection is rewired.
 */
export function planPalaceLanding(
  fragment: ParsedFragment,
  document: MindmapDocument,
  options: { placeholderNodeId?: string } = {},
): PalaceLandingPlan {
  const palaceNode = fragment.nodes.find((node) => node.type === PALACE_TYPE)
  if (!palaceNode) {
    throw new MindmapXmlError('invalid_type', 'Landing fragment is missing the palace node')
  }
  const data = palaceNode.data as {
    label?: unknown
    assetId?: unknown
    stations?: unknown
    sourceNodeIds?: unknown
  }
  const sourceNodeIds = Array.isArray(data.sourceNodeIds)
    ? data.sourceNodeIds.filter((id): id is string => typeof id === 'string')
    : []
  const landedData: Record<string, unknown> = {
    label: typeof data.label === 'string' ? data.label : '',
    stations: Array.isArray(data.stations) ? data.stations : [],
    sourceNodeIds,
    expanded: true,
  }
  if (typeof data.assetId === 'string' && data.assetId) landedData.assetId = data.assetId

  const placeholderId = options.placeholderNodeId
  if (placeholderId && document.nodes.some((node) => node.id === placeholderId)) {
    return {
      commands: [{ type: 'updateNode', nodeId: placeholderId, data: landedData }],
      nodeId: placeholderId,
      updatedPlaceholder: true,
      sourceNodeIds,
    }
  }

  const { parentId, position } = resolvePalacePlacement(document, sourceNodeIds)
  const palaceId = fragment.rootIds[0]!
  return {
    commands: [
      {
        type: 'addNode',
        node: { id: palaceId, type: PALACE_TYPE, position, data: landedData },
        edge: {
          id: `e-${parentId}-${palaceId}`,
          source: parentId,
          target: palaceId,
          type: 'mindmap',
          className: 'mindmap-edge',
        },
      },
      ...planRewireSelection(document, palaceId, sourceNodeIds),
    ],
    nodeId: palaceId,
    updatedPlaceholder: false,
    sourceNodeIds,
  }
}
