/**
 * Pure command/document types for the mindmap document semantics.
 *
 * "One command → one new document": applying a command is a stateless function
 * over the previous value, never a mutation. The stateful host (the
 * main-process document service) only owns history, layout and I/O; the
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
 * Layout structure the deterministic layout produces. Owned by the view style,
 * but the main process needs it to compute node positions.
 */
export type MindmapStructureType = 'logic' | 'mindmap'

/**
 * A document node: the XML node shape plus layout products (measured size,
 * handle sides). None of the extra fields is persisted; they are recomputed by
 * the layout pass and shipped with the versioned state.
 */
export interface MindmapDocumentNode extends MindmapXmlNode {
  /** Measured size reported by the renderer (the layout's real input). */
  measured?: { width?: number; height?: number }
  /** Handle directions written by the layout (render-only). */
  sourcePosition?: 'left' | 'right' | 'top' | 'bottom'
  targetPosition?: 'left' | 'right' | 'top' | 'bottom'
}

/**
 * The structural value a command is applied to. The contracts node/edge shapes
 * deliberately mirror ReactFlow's `Node` / `Edge`, which are structurally
 * assignable, so the live renderer projection can be handed over without an
 * adapter and the contracts layer stays UI-free.
 */
export interface MindmapDocument {
  nodes: MindmapDocumentNode[]
  edges: MindmapDocumentEdge[]
}

/**
 * A command describing one structural operation. Commands are values: the
 * `updateNode` patch is the only function, and it must be pure. It never
 * crosses the process boundary — the bridge carries `MindmapWireCommand`.
 */
export type MindmapCommand =
  | { type: 'addNode'; node: MindmapDocumentNode; edge?: MindmapDocumentEdge }
  | {
      type: 'updateNode'
      nodeId: string
      patch: (node: MindmapDocumentNode) => MindmapDocumentNode
    }
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

/** Point-in-time structural snapshot: nodes and edges only (no view state). */
export interface MindmapSnapshot {
  nodes: MindmapDocumentNode[]
  edges: MindmapDocumentEdge[]
}

/** One history entry: the pre-execution snapshot plus the executed commands. */
export interface MindmapTransaction {
  id: string
  before: MindmapSnapshot
  commands: MindmapCommand[]
  timestamp: number
}

/**
 * Node-data flags that are view state, never document content: they are
 * stripped before a document state is recorded in history (and the node
 * descriptors never serialize them).
 */
export const TRANSIENT_NODE_DATA_FLAGS = [
  'editing',
  'justAdded',
  'exiting',
  'processing',
  'expanded',
  'generating',
  // Manual palace run state (live progress and the resume affordance).
  'runStage',
  'runStopped',
  // Cascade animation transient markers (agent write path):
  // staggered enter delay / reverse exit delay / gliding and its origin.
  'cascadeDelay',
  'exitingDelay',
  'gliding',
  'glideFrom',
] as const

export type TransientNodeDataFlag = (typeof TRANSIENT_NODE_DATA_FLAGS)[number]

/** Strip every view-only flag from one node's data (returns a new node). */
export function stripTransientNodeData(node: MindmapDocumentNode): MindmapDocumentNode {
  let changed = false
  const data = { ...node.data }
  for (const flag of TRANSIENT_NODE_DATA_FLAGS) {
    if (!(flag in data)) continue
    delete data[flag]
    changed = true
  }
  return changed ? { ...node, data } : node
}

/** Strip view-only flags from a snapshot/document (history and saves never carry them). */
export function stripTransientNodeDataFrom(nodes: MindmapDocumentNode[]): MindmapDocumentNode[] {
  return nodes.map(stripTransientNodeData)
}
