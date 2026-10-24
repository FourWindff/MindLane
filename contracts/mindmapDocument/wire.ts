/**
 * Serializable command shape: what actually crosses the bridge.
 *
 * The pure command layer carries one function (`updateNode.patch`); functions
 * cannot be cloned over IPC, so the renderer expresses the same operation as a
 * data merge plus an optional position. `toMindmapCommand` is the single
 * translation point, so the structural semantics still live only in
 * `commands.ts`.
 */

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
