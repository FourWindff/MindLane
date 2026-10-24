/**
 * The main-process write service: the four AI write tools and the palace's
 * deterministic landing apply straight to the document service.
 *
 * There is no renderer round trip, so a minimized window or a busy renderer can
 * never fail a write, and no ack/timeout bookkeeping exists. Landing stays
 * immediate (it happens while the tool runs, so `tool-end` always follows the
 * document change) and the result goes back to the model unchanged.
 *
 * Per-file serialization is the document service's own: a plan is built from the
 * current document and applied in the same synchronous block, so two writes for
 * one file can never interleave — no separate queue exists.
 *
 * Assets (palace artwork) are document content: they join the file's asset
 * collection in the same step, and the renderer receives them with the state.
 */

import { MindmapXmlError } from '../../../contracts/mindmapXml/types.js'
import { formatXmlError } from '../../../contracts/mindmapXml/errors.js'
import {
  parseXmlFragment,
  type ParsedFragment,
} from '../../../contracts/mindmapXml/deserializer.js'
import { assetFromDataUrl } from '../../../contracts/mindmapXml/asset.js'
import type { MindmapDocument } from '../../../contracts/mindmapDocument/types.js'
import type { MindmapWireCommand } from '../../../contracts/mindmapDocument/wire.js'
import {
  planFragmentInsert,
  planNodeDeletion,
  planNodeMove,
  planNodeReplacement,
  type FragmentInsertPosition,
  type MovePosition,
} from '../../../contracts/mindmapDocument/fragment.js'
import { planPalaceLanding } from '../../../contracts/mindmapDocument/palace.js'
import type { MindLaneAsset } from '../../../contracts/mindmapXml/types.js'
import type { MindmapWrite } from '../../../contracts/mindmapDocument/writeAction.js'
import type { MindmapDocumentService } from './documentService.js'

export interface MindmapWriteServiceOptions {
  documentService: MindmapDocumentService
  /** Diagnostics sink for recoverable landing degradations (unreadable artwork). */
  warn?: (message: string) => void
}

const PALACE_TYPE = 'palace'
const INSERT_POSITIONS = new Set<FragmentInsertPosition>(['root', 'child', 'after', 'before'])
const MOVE_POSITIONS = new Set<MovePosition>(['child', 'after', 'before'])

/** A palace artwork data URL materialized into an asset for one node. */
interface ArtworkAsset {
  nodeId: string
  asset: MindLaneAsset
}

/** A parsed fragment plus the artwork bytes it referenced as data URLs. */
interface PreparedFragment {
  fragment: ParsedFragment
  artwork: ArtworkAsset[]
}

/** One landing: the commands plus the assets that must be live before they apply. */
interface LandingPlan {
  commands: MindmapWireCommand[]
  assets: MindLaneAsset[]
}

function notOpen(): Error {
  return new Error('This file is not open, cannot land')
}

function requireXml(args: Record<string, unknown>): string {
  if (typeof args.xml !== 'string') {
    throw new MindmapXmlError('empty_xml', 'The xml argument is missing')
  }
  return args.xml
}

function optionalPosition(
  value: unknown,
  allowed: Set<string>,
  message: string,
): string | undefined {
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`Invalid position argument: ${String(value)}; ${message}`)
  }
  return value
}

/**
 * Parse the fragment and read every palace artwork data URL into an asset.
 * Artwork is decoration: bytes that cannot be read simply mean "no artwork",
 * never a failed landing.
 */
async function prepareFragment(
  xml: string,
  warn: (message: string) => void,
): Promise<PreparedFragment> {
  const fragment = await parseXmlFragment(xml)
  const artwork: ArtworkAsset[] = []
  for (const node of fragment.nodes) {
    if (node.type !== PALACE_TYPE) continue
    const data = node.data as Record<string, unknown>
    if (typeof data.assetId === 'string' && data.assetId) continue
    if (typeof data.imageUrl !== 'string' || !data.imageUrl) continue

    const asset = await assetFromDataUrl(data.imageUrl)
    if (!asset) {
      delete data.imageUrl
      warn('Palace artwork could not be read; landing the palace without an image')
      continue
    }
    artwork.push({ nodeId: node.id, asset })
  }
  return { fragment, artwork }
}

/**
 * Point each artwork node at its asset id, reusing an existing asset with the
 * same bytes (assets are deduplicated by sha256). Returns the assets that still
 * have to be added to the file.
 */
function resolveArtwork(prepared: PreparedFragment, assets: MindLaneAsset[]): MindLaneAsset[] {
  const pending: MindLaneAsset[] = []
  const nodes = new Map(prepared.fragment.nodes.map((node) => [node.id, node]))
  for (const piece of prepared.artwork) {
    const node = nodes.get(piece.nodeId)
    if (!node) continue
    const data = node.data as Record<string, unknown>
    const existing = [...assets, ...pending].find(
      (candidate) => candidate.sha256 === piece.asset.sha256,
    )
    data.assetId = existing?.id ?? piece.asset.id
    delete data.imageUrl
    if (!existing) pending.push(piece.asset)
  }
  return pending
}

export function createMindmapWrite(options: MindmapWriteServiceOptions): MindmapWrite {
  const { documentService } = options
  const warn = options.warn ?? (() => {})

  /**
   * Read the authoritative value the plan is built from. Everything from here
   * to the apply runs synchronously, so the plan and the document it applies to
   * are the same moment (and two writes for one file serialize here).
   */
  function snapshot(fileUuid: string): { document: MindmapDocument; assets: MindLaneAsset[] } {
    const document = documentService.getDocument(fileUuid)
    if (!document) throw notOpen()
    return { document, assets: documentService.getAssets(fileUuid) }
  }

  /** Land one plan: assets first (nodes never point at a missing asset), then the commands. */
  function land(fileUuid: string, plan: LandingPlan): void {
    if (plan.assets.length > 0) {
      const added = documentService.handle({ type: 'addAssets', fileUuid, assets: plan.assets })
      if (!added.ok) {
        if (added.code === 'document_not_found') throw notOpen()
        throw new MindmapXmlError(added.code, added.message)
      }
    }
    const applied = documentService.handle({
      type: 'apply',
      fileUuid,
      commands: plan.commands,
    })
    if (!applied.ok) {
      if (applied.code === 'document_not_found') throw notOpen()
      throw new MindmapXmlError(applied.code, applied.message)
    }
  }

  async function insertXmlFragment(
    fileUuid: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const xml = requireXml(args)
    const position = optionalPosition(
      args.position,
      INSERT_POSITIONS,
      'must be root/child/after/before',
    ) as FragmentInsertPosition | undefined
    const targetId =
      typeof args.targetId === 'string' && args.targetId.trim() ? args.targetId : undefined
    const prepared = await prepareFragment(xml, warn)
    const { document, assets } = snapshot(fileUuid)
    const pending = resolveArtwork(prepared, assets)
    const commands = planFragmentInsert(prepared.fragment, document, [...assets, ...pending], {
      targetId,
      position,
    })
    land(fileUuid, { commands, assets: pending })
    return {
      nodeCount: prepared.fragment.nodes.length,
      targetId: targetId ?? null,
      position: position ?? 'child',
    }
  }

  async function updateMindmapNode(
    fileUuid: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const xml = requireXml(args)
    const prepared = await prepareFragment(xml, warn)
    const { document, assets } = snapshot(fileUuid)
    const pending = resolveArtwork(prepared, assets)
    const commands = planNodeReplacement(prepared.fragment, document, [...assets, ...pending])
    land(fileUuid, { commands, assets: pending })
    return {
      xml,
      nodeId: prepared.fragment.rootIds[0],
      nodeCount: prepared.fragment.nodes.length,
    }
  }

  function moveMindmapNode(fileUuid: string, args: Record<string, unknown>): unknown {
    if (typeof args.nodeId !== 'string' || !args.nodeId.trim()) {
      throw new MindmapXmlError('block_not_found', 'The nodeId argument is missing')
    }
    const position = optionalPosition(
      args.position,
      MOVE_POSITIONS,
      'must be child/after/before',
    ) as MovePosition | undefined
    const targetId =
      typeof args.targetId === 'string' && args.targetId.trim() ? args.targetId : 'root'
    const nodeId = args.nodeId
    const { document } = snapshot(fileUuid)
    const commands = planNodeMove(document, nodeId, targetId, position ?? 'child')
    land(fileUuid, { commands, assets: [] })
    return { nodeId, targetId, position: position ?? 'child' }
  }

  function deleteMindmapNode(fileUuid: string, args: Record<string, unknown>): unknown {
    if (typeof args.nodeId !== 'string' || !args.nodeId.trim()) {
      throw new MindmapXmlError('block_not_found', 'The nodeId argument is missing')
    }
    const nodeId = args.nodeId
    const { document } = snapshot(fileUuid)
    const commands = planNodeDeletion(document, nodeId)
    if (args.confirmDeleteSubtree === false) return { nodeId, deleted: false }
    land(fileUuid, { commands, assets: [] })
    return { nodeId, deleted: true }
  }

  async function landPalace(fileUuid: string, args: Record<string, unknown>): Promise<unknown> {
    const xml = requireXml(args)
    const placeholderNodeId =
      typeof args.placeholderNodeId === 'string' && args.placeholderNodeId
        ? args.placeholderNodeId
        : undefined
    const prepared = await prepareFragment(xml, warn)
    const { document, assets } = snapshot(fileUuid)
    const pending = resolveArtwork(prepared, assets)
    const plan = planPalaceLanding(prepared.fragment, document, { placeholderNodeId })
    land(fileUuid, { commands: plan.commands, assets: pending })
    return {
      nodeId: plan.nodeId,
      updatedPlaceholder: plan.updatedPlaceholder,
      sourceNodeIds: plan.sourceNodeIds,
    }
  }

  /**
   * One write: landing failures never throw out of here — the error text goes
   * back to the model as the tool result and the stream keeps going.
   */
  return async (fileUuid, action, args) => {
    try {
      let data: unknown
      switch (action) {
        case 'insertXmlFragment':
          data = await insertXmlFragment(fileUuid, args)
          break
        case 'updateMindmapNode':
          data = await updateMindmapNode(fileUuid, args)
          break
        case 'moveMindmapNode':
          data = moveMindmapNode(fileUuid, args)
          break
        case 'deleteMindmapNode':
          data = deleteMindmapNode(fileUuid, args)
          break
        case 'landPalace':
          data = await landPalace(fileUuid, args)
          break
        default: {
          const neverAction: never = action
          throw new Error(`Unknown write action: ${String(neverAction)}`)
        }
      }
      return { ok: true, action, data }
    } catch (error) {
      return { ok: false, error: formatXmlError(error) }
    }
  }
}
