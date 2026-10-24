/**
 * Versioned document state and the one command channel both processes speak.
 *
 * The main process is the only writer: every intent (a structural command, a
 * history step, a layout input, a save acknowledgement) goes through
 * `MindmapDocumentIntent`. State carries a monotonically increasing version so
 * a renderer can discard anything older than what it already shows.
 */

import type { MindLaneAsset, MindmapXmlErrorCode } from '../mindmapXml/types.js'
import type {
  MindmapDocument,
  MindmapDocumentEdge,
  MindmapDocumentNode,
  MindmapStructureType,
} from './types.js'
import type { MindmapWireCommand } from './wire.js'

/** The versioned state pushed to the renderer after every document change. */
export interface MindmapDocumentState {
  fileUuid: string
  /** Monotonic document version; a state with a version <= the shown one is stale. */
  version: number
  nodes: MindmapDocumentNode[]
  edges: MindmapDocumentEdge[]
  structureType: MindmapStructureType
  canUndo: boolean
  canRedo: boolean
  /** The document has unsaved structural changes. */
  dirty: boolean
  /**
   * Assets added since the previous state of this file (append-only, absent when
   * nothing was added). Asset bytes are large, so they ride once instead of
   * inside every versioned state; the renderer merges them by id.
   */
  addedAssets?: MindLaneAsset[]
}

/** Measured node size reported by the renderer; a layout input, never persisted. */
export interface MindmapNodeSizeUpdate {
  id: string
  width: number
  height: number
}

/**
 * Every request that may enter the document service. `apply` is the only path
 * that changes the tree; human edits and AI writes use it identically.
 * `addAssets` appends embedded images, which are document content too (they
 * live in the file's assets section), so the same owner validates both.
 */
export type MindmapDocumentIntent =
  | {
      type: 'open'
      fileUuid: string
      /** Initial document value (read from the file by the caller). */
      document: MindmapDocument
      /** The file's embedded assets: the document owns them, writes validate against them. */
      assets?: MindLaneAsset[]
      structureType: MindmapStructureType
    }
  | { type: 'apply'; fileUuid: string; commands: MindmapWireCommand[] }
  | { type: 'addAssets'; fileUuid: string; assets: MindLaneAsset[] }
  | { type: 'undo'; fileUuid: string }
  | { type: 'redo'; fileUuid: string }
  | {
      type: 'layout'
      fileUuid: string
      structureType?: MindmapStructureType
      sizes?: MindmapNodeSizeUpdate[]
    }
  | { type: 'markSaved'; fileUuid: string; version: number }
  | { type: 'reset'; fileUuid: string }
  | { type: 'close'; fileUuid: string }

/** Failure of a document intent: the existing XML error vocabulary. */
export interface MindmapDocumentFailure {
  ok: false
  code: MindmapXmlErrorCode | 'document_not_found'
  message: string
}

export type MindmapDocumentCommandResult =
  { ok: true; state: MindmapDocumentState | null } | MindmapDocumentFailure
