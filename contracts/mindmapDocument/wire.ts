/**
 * Serializable command shape: what actually crosses the bridge.
 *
 * This is the renderer's entire document vocabulary: it can state an intent in
 * this shape and nothing else (no function-valued patches cross the bridge).
 * `toMindmapCommand` is the single translation point back into the pure command
 * layer, so the structural semantics still live only in `commands.ts`.
 */

import { TRANSIENT_NODE_DATA_FLAGS, stripTransientNodeData } from './types.js'
import type { MindmapCommand, MindmapDocumentEdge, MindmapDocumentNode } from './types.js'

export type MindmapWireCommand =
  | { type: 'addNode'; node: MindmapDocumentNode; edge?: MindmapDocumentEdge }
  | {
      type: 'updateNode'
      nodeId: string
      /** Shallow data merge; an explicit `undefined` clears the key. */
      data?: Record<string, unknown>
      position?: { x: number; y: number }
    }
  | { type: 'deleteSubtree'; rootId: string }
  | { type: 'moveNode'; nodeId: string; position: { x: number; y: number } }
  | { type: 'addEdge'; edge: MindmapDocumentEdge; index?: number }
  | { type: 'removeEdge'; edgeId: string }
  | { type: 'batch'; commands: MindmapWireCommand[] }

/** Translate one serializable command into the pure command the document applies. */
export function toMindmapCommand(command: MindmapWireCommand): MindmapCommand {
  switch (command.type) {
    case 'updateNode': {
      const { nodeId, data, position } = command
      return {
        type: 'updateNode',
        nodeId,
        patch: (node) => ({
          ...node,
          ...(position ? { position } : {}),
          ...(data ? { data: { ...node.data, ...data } } : {}),
        }),
      }
    }
    case 'batch':
      return { type: 'batch', commands: command.commands.map(toMindmapCommand) }
    default:
      return command
  }
}

/** Translate a serializable batch into pure commands. */
export function toMindmapCommands(commands: MindmapWireCommand[]): MindmapCommand[] {
  return commands.map(toMindmapCommand)
}

/**
 * Drop view-only node data from a serializable command batch.
 *
 * View state (animation markers, run flags, editing) belongs to the renderer;
 * the document service applies this to every incoming batch, so no host can
 * leave view state in the authoritative document (or in its history).
 */
export function stripTransientWireCommands(commands: MindmapWireCommand[]): MindmapWireCommand[] {
  return commands.map((command) => {
    switch (command.type) {
      case 'addNode':
        return { ...command, node: stripTransientNodeData(command.node) }
      case 'updateNode': {
        if (!command.data) return command
        const data = { ...command.data }
        for (const flag of TRANSIENT_NODE_DATA_FLAGS) delete data[flag]
        return { ...command, data }
      }
      case 'batch':
        return { ...command, commands: stripTransientWireCommands(command.commands) }
      default:
        return command
    }
  })
}
