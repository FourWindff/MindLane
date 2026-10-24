/**
 * Pure command/document types for the mindmap document semantics.
 *
 * "One command → one new document": applying a command is a stateless function
 * over the previous value, never a mutation. The stateful hosts (the renderer
 * editor today, the document service later) only own history and I/O; the
 * semantics live here so validation and landing cannot drift apart.
 *
 * This module is part of the contracts layer: types and pure functions only,
 * no DOM, no React and no Electron.
 */

import type { MindmapXmlEdge, MindmapXmlErrorCode, MindmapXmlNode } from '../mindmapXml/types.js'

/**
 * Document edge: the XML edge shape plus the renderer animation class the live
 * editor carries. The class is command payload, not XML content.
 */
export interface MindmapDocumentEdge extends MindmapXmlEdge {
  className?: string
}

/**
 * The structural value a command is applied to. The contracts node/edge shapes
 * deliberately mirror ReactFlow's `Node` / `Edge`, which are structurally
 * assignable, so the live renderer state can be handed over without an adapter
 * and the contracts layer stays UI-free.
 */
export interface MindmapDocument {
  nodes: MindmapXmlNode[]
  edges: MindmapDocumentEdge[]
}

/**
 * A command describing one structural operation. Commands are values: the
 * `updateNode` patch is the only function, and it must be pure.
 */
export type MindmapCommand =
  | { type: 'addNode'; node: MindmapXmlNode; edge?: MindmapDocumentEdge }
  | { type: 'updateNode'; nodeId: string; patch: (node: MindmapXmlNode) => MindmapXmlNode }
  | { type: 'deleteSubtree'; rootId: string }
  | { type: 'moveNode'; nodeId: string; position: { x: number; y: number } }
  | { type: 'addEdge'; edge: MindmapDocumentEdge; index?: number }
  | { type: 'removeEdge'; edgeId: string }
  | { type: 'batch'; commands: MindmapCommand[] }

/** Failure envelope: the existing XML error vocabulary, no new codes. */
export interface CommandFailure {
  ok: false
  code: MindmapXmlErrorCode
  message: string
}

/** Success envelope of applying one command. */
export interface CommandApplied {
  ok: true
  document: MindmapDocument
}

export type CommandResult = CommandApplied | CommandFailure

/**
 * Success envelope of applying a command batch. `recordHistory` and `reflow`
 * are the pure history/layout gates the host would otherwise re-derive.
 */
export interface CommandBatchApplied extends CommandApplied {
  recordHistory: boolean
  reflow: boolean
}

export type CommandBatchResult = CommandBatchApplied | CommandFailure
