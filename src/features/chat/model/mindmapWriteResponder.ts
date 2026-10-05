import type { Edge, Node } from '@xyflow/react'
import type { MindmapEditor } from '@/features/mindmap/model/editor'
import type { MindmapCommand } from '@/features/mindmap/model/types'
import { CHILD_OFFSET_X, findParentId, newId } from '@/features/mindmap/model/mindmapTree'
import {
  MindmapXmlError,
  buildValidationContext,
  formatXmlError,
  isValidSvgArtwork,
  parseXmlFragment,
  serializeMindmapSection,
  type MindLaneAsset,
  validateMove,
} from '@contracts/mindmapXml'
import { assetFromDataUrl, parseDataUrl } from '@contracts/mindmapXml/asset'
import type {
  MindmapWriteRequest,
  MindmapWriteResponse,
  WriteAction,
  WriteActionArgs,
} from '@contracts/ipc'

/**
 * Renderer-side landing responder (PRD: live apply, second half).
 *
 * Subscribes to the main process's write request channel (contract 01: requestId +
 * fileUuid + action + args), resolves the live editor by fileUuid, atomically
 * validates and lands the map, then returns a structured `{ok, action, data}` or
 * an error — that result is the ack, and the main process hands it back to the
 * model verbatim as the tool result. Validation reuses the shared mindmapXml
 * library (error codes + recovery wording share the main process's vocabulary).
 *
 * Concurrent tool calls must not interleave writes to the same editor: requests
 * are serialized per fileUuid into one queue per file, and different fileUuids
 * never block each other. Timeout semantics belong to the main process; here we
 * only guarantee a single response.
 */
interface MindmapWriteResponderDependencies {
  /** Subscribes to the main process's write request channel (returns an unsubscribe function). */
  subscribe: (listener: (request: MindmapWriteRequest) => void) => () => void
  /** fileUuid → live editor; undefined when the file is not open. */
  resolveEditor: (fileUuid: string) => MindmapEditor | undefined
  /** Post-landing persistence callback (fire-and-forget, e.g. saveOpenFile). */
  persistFile: (fileUuid: string) => void
  /** Renderer → main process landing response (an unknown requestId is a no-op). */
  respond: (payload: MindmapWriteResponse) => void | Promise<void>
  /** Diagnostics log for recoverable landing degradations. */
  warn: (message: string) => void
}

export function createMindmapWriteResponder(deps: MindmapWriteResponderDependencies) {
  // Serial queue per fileUuid: requests for the same file run one after another,
  // while different files keep independent chains.
  const queues = new Map<string, Promise<void>>()
  let unsubscribe: (() => void) | null = null

  function enqueue(request: MindmapWriteRequest): void {
    const previous = queues.get(request.fileUuid) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(() => handleRequest(request))
    queues.set(request.fileUuid, task)
    void task.finally(() => {
      // Only clear the slot when it still points at this task: requests queued
      // afterwards must not be dropped by this task's cleanup.
      if (queues.get(request.fileUuid) === task) queues.delete(request.fileUuid)
    })
  }

  async function handleRequest(request: MindmapWriteRequest): Promise<void> {
    try {
      const editor = deps.resolveEditor(request.fileUuid)
      if (!editor) {
        await deps.respond({
          requestId: request.requestId,
          ok: false,
          error: 'This file is not open, cannot land',
        })
        return
      }
      const data = await applyWriteAction(request.action, request.args, editor, deps.warn)
      deps.persistFile(request.fileUuid)
      await safeRespond({
        requestId: request.requestId,
        ok: true,
        action: request.action,
        data,
      })
    } catch (err) {
      await safeRespond({
        requestId: request.requestId,
        ok: false,
        error: formatXmlError(err),
      })
    }
  }

  function safeRespond(payload: MindmapWriteResponse): Promise<void> {
    // The ack channel has nowhere to report failures (timeout semantics belong
    // to the main process); only avoid an unhandled rejection here.
    return Promise.resolve(deps.respond(payload)).catch(() => undefined)
  }

  return {
    start(): () => void {
      unsubscribe?.()
      unsubscribe = deps.subscribe((request) => void enqueue(request))
      return () => {
        unsubscribe?.()
        unsubscribe = null
        queues.clear()
      }
    },
  }
}

const DEFAULT_POSITION = 'child'
const INSERT_POSITIONS = new Set(['root', 'child', 'after', 'before'])
const MOVE_POSITIONS = new Set(['child', 'after', 'before'])
const PALACE_TYPE = 'palace'

function decodeBase64Utf8(data: string): string | null {
  try {
    const binary = atob(data)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

async function materializePalaceArtwork(
  xml: string,
  editor: MindmapEditor,
  warn: (message: string) => void,
): Promise<{ xml: string; nodeCount: number; rootId: string; assets: MindLaneAsset[] }> {
  const parsed = await parseXmlFragment(xml)
  const assets: MindLaneAsset[] = []
  let changed = false

  for (const node of parsed.nodes) {
    if (node.type !== PALACE_TYPE) continue
    const data = node.data as Record<string, unknown>
    if (typeof data.assetId === 'string' && data.assetId) continue
    if (typeof data.imageUrl !== 'string') continue

    const dataUrl = parseDataUrl(data.imageUrl)
    if (!dataUrl) continue
    if (dataUrl.mime.toLowerCase() === 'image/svg+xml') {
      const svg = decodeBase64Utf8(dataUrl.data)
      const stationCount = Array.isArray(data.stations) ? data.stations.length : 0
      if (!svg || !isValidSvgArtwork(svg, stationCount)) {
        delete data.imageUrl
        changed = true
        warn('Palace artwork failed the gate; using a palace without an image')
        continue
      }
    }

    const asset = await assetFromDataUrl(data.imageUrl)
    if (!asset) continue
    const existingAsset = [...editor.getState().assets, ...assets].find(
      (candidate) => candidate.sha256 === asset.sha256,
    )
    data.assetId = existingAsset?.id ?? asset.id
    if (!existingAsset) assets.push(asset)
    delete data.imageUrl
    changed = true
  }

  return {
    xml: changed ? serializeMindmapSection(parsed.nodes, parsed.edges) : xml,
    nodeCount: parsed.nodes.length,
    rootId: parsed.rootIds[0]!,
    assets,
  }
}

/**
 * MindmapEditor.batch + editor.getState().addAsset use the same store: this
 * responder is the sole writer for both, so it can leave the batch
 * bookkeeping to the editor.
 */
function clearProcessingCommands(sourceNodeIds: string[]): MindmapCommand[] {
  return sourceNodeIds.map((nodeId) => ({
    type: 'updateNode' as const,
    nodeId,
    patch: (node: Node) => ({ ...node, data: { ...node.data, processing: undefined } }),
  }))
}

/**
 * Deterministic palace placement (CONTEXT.md "deterministic landing"): under the parent of
 * the first source node, at that node's position (so the palace takes the slot
 * and the source nodes move under it). No source nodes → a new child of root.
 */
function palacePlacement(
  editor: MindmapEditor,
  sourceNodeIds: string[],
): { parentId: string; position: { x: number; y: number } } {
  const { nodes, edges } = editor.getState()
  const firstSource = sourceNodeIds[0]
    ? nodes.find((node) => node.id === sourceNodeIds[0])
    : undefined
  const parentId = (firstSource ? findParentId(edges, firstSource.id) : null) ?? 'root'
  if (firstSource) return { parentId, position: firstSource.position }
  const parentNode = nodes.find((node) => node.id === parentId)
  return {
    parentId,
    position: {
      x: (parentNode?.position.x ?? 0) + CHILD_OFFSET_X,
      y: parentNode?.position.y ?? 0,
    },
  }
}

/**
 * The manual run's placeholder palace: a progress node with a "continue" entry
 * point that exists before the payload is generated. The placement code is shared
 * with the landing insertion branch, so the placeholder and the final palace land
 * in the same spot.
 * Returns the node id (the renderer's run registry locates it by that id).
 */
export function insertPalacePlaceholder(
  editor: MindmapEditor,
  sourceNodeIds: string[],
): { nodeId: string } {
  const palaceId = newId()
  const { parentId, position } = palacePlacement(editor, sourceNodeIds)
  for (const nodeId of sourceNodeIds) editor.setNodeFlag(nodeId, 'processing', true)
  editor.batch([
    {
      type: 'addNode',
      node: {
        id: palaceId,
        type: PALACE_TYPE,
        position,
        data: {
          label: 'Generating…',
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
    ...placeSourceNodesCommands(editor, palaceId, sourceNodeIds),
  ])
  return { nodeId: palaceId }
}

/**
 * Rewire: parent → palace → each source node. Every incoming edge of a source
 * node is replaced (whichever parent it had), so the selection can span several
 * parents without breaking the pure-tree invariant. The root anchor is never
 * reparented — it stays the tree's root.
 */
function placeSourceNodesCommands(
  editor: MindmapEditor,
  palaceId: string,
  sourceNodeIds: string[],
): MindmapCommand[] {
  const { edges, nodes } = editor.getState()
  const live = new Set(nodes.map((node) => node.id))
  // A source node deleted mid-run must not leave a dangling edge behind.
  const sourceIds = new Set(sourceNodeIds.filter((nodeId) => nodeId !== 'root' && live.has(nodeId)))
  const childEdges: Edge[] = [...sourceIds].map((nodeId) => ({
    id: `e-${palaceId}-${nodeId}`,
    source: palaceId,
    target: nodeId,
    type: 'mindmap',
    className: 'mindmap-edge',
  }))
  return [
    ...childEdges.map((edge) => ({ type: 'addEdge' as const, edge })),
    ...edges
      .filter((edge) => sourceIds.has(edge.target))
      .map((edge) => ({ type: 'removeEdge' as const, edgeId: edge.id })),
  ]
}

/**
 * The manual run's placeholder for these source nodes — found by content, so the
 * landing request stays identical for both trigger surfaces (no placeholder id
 * rides over IPC). Two concurrent palaces from the same selection would collide;
 * that is not a reachable user flow (one run per file at a time).
 */
function findPalacePlaceholder(editor: MindmapEditor, sourceNodeIds: string[]): Node | undefined {
  const key = [...sourceNodeIds].sort().join('\0')
  return editor.getState().nodes.find((node) => {
    if (node.type !== PALACE_TYPE || node.data.generating !== true) return false
    const ids = Array.isArray(node.data.sourceNodeIds) ? (node.data.sourceNodeIds as string[]) : []
    return [...ids].sort().join('\0') === key
  })
}

/**
 * Palace landing (write action landPalace): the XML is serialized by code from the
 * subgraph payload (the model never repeats the image data URL). The placeholder
 * node is updated in place by sourceNodeIds; without a placeholder a new node is
 * created and the parent edges are rewired as "new palace → selected nodes". Image
 * assets are materialized here (the same gate as insertXmlFragment).
 */
async function applyPalaceLanding(
  editor: MindmapEditor,
  materialized: Awaited<ReturnType<typeof materializePalaceArtwork>>,
): Promise<{ nodeId: string; updatedPlaceholder: boolean; sourceNodeIds: string[] }> {
  const parsed = await parseXmlFragment(materialized.xml)
  const palaceNode = parsed.nodes.find((node) => node.type === PALACE_TYPE)
  if (!palaceNode) {
    throw new MindmapXmlError('invalid_type', 'Landing fragment is missing the palace node')
  }
  const data = palaceNode.data as {
    label?: unknown
    assetId?: unknown
    stations?: unknown
    sourceNodeIds?: unknown
  }
  const sourceNodeIds = Array.isArray(data.sourceNodeIds) ? (data.sourceNodeIds as string[]) : []
  const landedData: Record<string, unknown> = {
    label: typeof data.label === 'string' ? data.label : '',
    stations: Array.isArray(data.stations) ? data.stations : [],
    sourceNodeIds,
    expanded: true,
  }
  if (typeof data.assetId === 'string' && data.assetId) landedData.assetId = data.assetId

  // Assets become live before the node points at them, same as insertFromXml.
  for (const asset of materialized.assets) editor.getState().addAsset(asset)

  const placeholder = findPalacePlaceholder(editor, sourceNodeIds)
  if (placeholder) {
    // The run's own transient flags live only on the placeholder; a fresh node
    // never carries them.
    const clearedFlags = {
      generating: undefined,
      runStage: undefined,
      runStopped: undefined,
    }
    editor.batch([
      {
        type: 'updateNode',
        nodeId: placeholder.id,
        patch: (node: Node) => ({
          ...node,
          data: { ...node.data, ...clearedFlags, ...landedData },
        }),
      },
      ...clearProcessingCommands(sourceNodeIds),
    ])
    return { nodeId: placeholder.id, updatedPlaceholder: true, sourceNodeIds }
  }

  const { parentId, position } = palacePlacement(editor, sourceNodeIds)
  const palaceId = materialized.rootId
  editor.batch([
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
    ...placeSourceNodesCommands(editor, palaceId, sourceNodeIds),
    ...clearProcessingCommands(sourceNodeIds),
  ])
  return { nodeId: palaceId, updatedPlaceholder: false, sourceNodeIds }
}

/**
 * Atomic validation + landing: a validation failure throws MindmapXmlError (the
 * error code + recovery strategy are formatted uniformly by formatXmlError) and
 * never touches the editor; success returns the `data` payload (part of the ack).
 * The validation order matches the main-process snapshot validation (same
 * vocabulary once contract 01 moved into the shared library).
 */
async function applyWriteAction(
  action: WriteAction,
  args: Record<string, unknown>,
  editor: MindmapEditor,
  warn: (message: string) => void,
): Promise<unknown> {
  switch (action) {
    case 'landPalace': {
      const { xml } = args as WriteActionArgs['landPalace']
      if (typeof xml !== 'string') {
        throw new MindmapXmlError('empty_xml', 'The xml argument is missing')
      }
      const materialized = await materializePalaceArtwork(xml, editor, warn)
      return applyPalaceLanding(editor, materialized)
    }

    case 'insertXmlFragment': {
      const { xml, parentId, position } = args as WriteActionArgs['insertXmlFragment']
      if (typeof xml !== 'string') {
        throw new MindmapXmlError('empty_xml', 'The xml argument is missing')
      }
      if (typeof position !== 'undefined' && !INSERT_POSITIONS.has(position)) {
        throw new Error(
          `Invalid position argument: ${String(position)}; must be root/child/after/before`,
        )
      }
      const materialized = await materializePalaceArtwork(xml, editor, warn)
      const state = editor.getState()
      const { ctx } = buildValidationContext(state.nodes, state.edges, state.assets)
      const pos = position ?? DEFAULT_POSITION
      if (pos !== 'root' && parentId && !ctx.nodeIds.has(parentId)) {
        throw new MindmapXmlError('block_not_found', `Anchor node "${parentId}" does not exist`)
      }
      // insertFromXml re-runs validateFragmentForInsert on the live editor state,
      // so a structural failure surfaces as the same MindmapXmlError from there.
      if (materialized.assets.length > 0) {
        await editor.insertFromXml(
          materialized.xml,
          { parentId, position: pos },
          materialized.assets,
        )
      } else {
        await editor.insertFromXml(materialized.xml, { parentId, position: pos })
      }
      return { nodeCount: materialized.nodeCount, parentId: parentId ?? null, position: pos }
    }

    case 'updateMindmapNode': {
      const { xml } = args as WriteActionArgs['updateMindmapNode']
      if (typeof xml !== 'string') {
        throw new MindmapXmlError('empty_xml', 'The xml argument is missing')
      }
      const materialized = await materializePalaceArtwork(xml, editor, warn)
      if (materialized.assets.length > 0) {
        await editor.replaceNodeFromXml(materialized.xml, materialized.assets)
      } else {
        await editor.replaceNodeFromXml(materialized.xml)
      }
      return {
        xml: materialized.xml,
        nodeId: materialized.rootId,
        nodeCount: materialized.nodeCount,
      }
    }

    case 'moveMindmapNode': {
      const { nodeId, targetId, position } = args as WriteActionArgs['moveMindmapNode']
      if (typeof nodeId !== 'string' || !nodeId.trim()) {
        throw new MindmapXmlError('block_not_found', 'The nodeId argument is missing')
      }
      if (typeof position !== 'undefined' && !MOVE_POSITIONS.has(position)) {
        throw new Error(
          `Invalid position argument: ${String(position)}; must be child/after/before`,
        )
      }
      const target = typeof targetId === 'string' && targetId.trim() ? targetId : 'root'
      const state = editor.getState()
      const { ctx, childrenOf } = buildValidationContext(state.nodes, state.edges, state.assets)
      validateMove(nodeId, target, { nodeIds: ctx.nodeIds, childrenOf })
      const pos = position ?? DEFAULT_POSITION
      editor.moveSubtree(nodeId, target, pos)
      return { nodeId, targetId: target, position: pos }
    }

    case 'deleteNode': {
      const { nodeId, confirmDeleteSubtree } = args as WriteActionArgs['deleteNode']
      if (typeof nodeId !== 'string' || !nodeId.trim()) {
        throw new MindmapXmlError('block_not_found', 'The nodeId argument is missing')
      }
      if (nodeId === 'root') {
        throw new MindmapXmlError(
          'tree_invalid',
          'root is the mindmap anchor and cannot be deleted',
        )
      }
      // The renderer responder is now the sole validator (main-process snapshot
      // validation was removed): a missing node must fail with block_not_found
      // instead of silently no-oping and acing a false success.
      const state = editor.getState()
      const { ctx } = buildValidationContext(state.nodes, state.edges, state.assets)
      if (!ctx.nodeIds.has(nodeId)) {
        throw new MindmapXmlError(
          'block_not_found',
          `Node "${nodeId}" does not exist; call readMindmap to locate it again`,
        )
      }
      if (confirmDeleteSubtree === false) {
        return { nodeId, deleted: false }
      }
      editor.deleteSubtree(nodeId)
      return { nodeId, deleted: true }
    }

    default: {
      // The WriteAction union is exhaustive; this arm is unreachable and only
      // guards against adding a new action without a responder case.
      const neverAction: never = action
      throw new Error(`Unknown write action: ${neverAction}`)
    }
  }
}
