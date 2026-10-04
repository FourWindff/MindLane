import type { Edge, Node } from '@xyflow/react'

/**
 * A point-in-time structural snapshot of the mindmap, holding only nodes and edges.
 * The viewport, the selection, the style and the transient node UI flags are not part of a snapshot.
 */
export interface MindmapSnapshot {
  nodes: Node[]
  edges: Edge[]
}

/**
 * A command describing one structural operation. Every command is executed by
 * {@link MindmapEditor} and recorded in history.
 */
export type MindmapCommand =
  | { type: 'addNode'; node: Node; edge?: Edge }
  | { type: 'updateNode'; nodeId: string; patch: (node: Node) => Node }
  | { type: 'deleteSubtree'; rootId: string }
  | { type: 'moveNode'; nodeId: string; position: { x: number; y: number } }
  | { type: 'addEdge'; edge: Edge; index?: number }
  | { type: 'removeEdge'; edgeId: string }
  | { type: 'batch'; commands: MindmapCommand[] }

/**
 * One history entry: the snapshot taken before execution, the executed command (or command
 * group) and a timestamp. Undo restores `before`; redo re-runs `commands`.
 */
export interface MindmapTransaction {
  id: string
  before: MindmapSnapshot
  commands: MindmapCommand[]
  timestamp: number
}

/** Transient UI flags that must be stripped from history snapshots. */
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
