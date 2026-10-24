/**
 * Versioned document state and the one command channel both processes speak.
 *
 * The main process is the only writer: every intent (a structural command, a
 * history step, a layout input, a save acknowledgement) goes through
 * `MindmapDocumentIntent`. State carries a monotonically increasing version so
 * a renderer can discard anything older than what it already shows.
 */

import type { MindmapXmlErrorCode } from '../mindmapXml/types.js'
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
}

/** Measured node size reported by the renderer; a layout input, never persisted. */
export interface MindmapNodeSizeUpdate {
  id: string
  width: number
  height: number
}

/**
 * Every request the renderer may send. `apply` is the only path that mutates
 * the document; human edits and AI writes use it identically.
 */
export type MindmapDocumentIntent =
  | {
      type: 'open'
      fileUuid: string
      /** Initial document value (read from the file by the caller). */
      document: MindmapDocument
      structureType: MindmapStructureType
    }
  | { type: 'apply'; fileUuid: string; commands: MindmapWireCommand[] }
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
