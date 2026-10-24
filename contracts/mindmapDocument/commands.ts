/**
 * Pure command application: old document + command(s) → new document + result
 * envelope. Nothing here touches the DOM, Electron, or any host state.
 *
 * The main-process document service is the only host: it applies commands, keeps
 * the history stack and asks for layout. The renderer never calls these functions
 * — it sends `MindmapWireCommand` values down the one document command channel,
 * so the structural semantics have exactly one writer.
 */

import { collectSubtreeIds } from './tree.js'
import type {
  CommandBatchResult,
  CommandFailure,
  CommandResult,
  MindmapCommand,
  MindmapDocument,
} from './types.js'
import type { MindmapXmlErrorCode } from '../mindmapXml/types.js'

function failure(code: MindmapXmlErrorCode, message: string): CommandFailure {
  return { ok: false, code, message }
}

/**
 * Apply one command to a document value.
 *
 * Commands that target a missing node are successful no-ops when the previous
 * editor semantics were a no-op (update/move/remove of an unknown id); commands
 * that would create an invalid tree return the existing XML error vocabulary.
 */
export function applyDocumentCommand(
  document: MindmapDocument,
  command: MindmapCommand,
): CommandResult {
  switch (command.type) {
    case 'addNode': {
      const { node, edge } = command
      if (document.nodes.some((existing) => existing.id === node.id)) {
        return failure('tree_invalid', `Node "${node.id}" already exists`)
      }
      if (edge) {
        const ids = new Set(document.nodes.map((existing) => existing.id))
        ids.add(node.id)
        if (!ids.has(edge.source)) {
          return failure('block_not_found', `Edge source node "${edge.source}" does not exist`)
        }
        if (!ids.has(edge.target)) {
          return failure('block_not_found', `Edge target node "${edge.target}" does not exist`)
        }
        if (edge.source === edge.target) {
          return failure('tree_invalid', 'An edge cannot connect a node to itself')
        }
        if (document.edges.some((existing) => existing.id === edge.id)) {
          return failure('tree_invalid', `Edge "${edge.id}" already exists`)
        }
      }
      return {
        ok: true,
        document: {
          nodes: [...document.nodes, node],
          edges: edge ? [...document.edges, edge] : document.edges,
        },
      }
    }

    case 'updateNode': {
      // Node data updates include collapsed state; an unknown id stays a no-op
      // so a flag-cleanup batch racing a delete still applies its other commands.
      if (!document.nodes.some((node) => node.id === command.nodeId)) {
        return { ok: true, document }
      }
      return {
        ok: true,
        document: {
          nodes: document.nodes.map((node) =>
            node.id === command.nodeId ? command.patch(node) : node,
          ),
          edges: document.edges,
        },
      }
    }

    case 'deleteSubtree': {
      if (command.rootId === 'root') {
        return failure('tree_invalid', 'The root node is the mindmap anchor and cannot be deleted')
      }
      // Unknown ids stay a no-op, matching the editor's previous traversal.
      if (!document.nodes.some((node) => node.id === command.rootId)) {
        return { ok: true, document }
      }
      const ids = collectSubtreeIds(document.edges, command.rootId)
      return {
        ok: true,
        document: {
          nodes: document.nodes.filter((node) => !ids.has(node.id)),
          edges: document.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
        },
      }
    }

    case 'moveNode': {
      if (!document.nodes.some((node) => node.id === command.nodeId)) {
        return { ok: true, document }
      }
      return {
        ok: true,
        document: {
          nodes: document.nodes.map((node) =>
            node.id === command.nodeId ? { ...node, position: command.position } : node,
          ),
          edges: document.edges,
        },
      }
    }

    case 'addEdge': {
      const ids = new Set(document.nodes.map((node) => node.id))
      if (!ids.has(command.edge.source)) {
        return failure(
          'block_not_found',
          `Edge source node "${command.edge.source}" does not exist`,
        )
      }
      if (!ids.has(command.edge.target)) {
        return failure(
          'block_not_found',
          `Edge target node "${command.edge.target}" does not exist`,
        )
      }
      if (command.edge.source === command.edge.target) {
        return failure('tree_invalid', 'An edge cannot connect a node to itself')
      }
      if (document.edges.some((edge) => edge.id === command.edge.id)) {
        return failure('tree_invalid', `Edge "${command.edge.id}" already exists`)
      }
      // Optional index: insert in place (order-preserving cases such as the
      // replace reattach); omitted, it appends at the end.
      if (
        command.index !== undefined &&
        command.index >= 0 &&
        command.index <= document.edges.length
      ) {
        return {
          ok: true,
          document: {
            nodes: document.nodes,
            edges: [
              ...document.edges.slice(0, command.index),
              command.edge,
              ...document.edges.slice(command.index),
            ],
          },
        }
      }
      return {
        ok: true,
        document: { nodes: document.nodes, edges: [...document.edges, command.edge] },
      }
    }

    case 'removeEdge': {
      if (!document.edges.some((edge) => edge.id === command.edgeId)) {
        return { ok: true, document }
      }
      return {
        ok: true,
        document: {
          nodes: document.nodes,
          edges: document.edges.filter((edge) => edge.id !== command.edgeId),
        },
      }
    }

    case 'batch': {
      let current = document
      for (const nested of command.commands) {
        const result = applyDocumentCommand(current, nested)
        if (!result.ok) return result
        current = result.document
      }
      return { ok: true, document: current }
    }

    default: {
      const unknown = command as { type?: unknown }
      return failure('invalid_type', `Unknown mindmap command type "${String(unknown.type)}"`)
    }
  }
}

/**
 * Pure history gate: an empty batch is not an undoable transaction, every
 * non-empty successful batch is. Hosts keep their own stack and size cap.
 */
export function shouldRecordHistory(commands: MindmapCommand[]): boolean {
  return commands.length > 0
}

/**
 * Pure layout gate: structure and node-data changes need a reflow, pure
 * position moves do not (they are already in visual coordinates). Nested
 * batches are inspected recursively.
 */
export function requiresLayoutAfter(commands: MindmapCommand[]): boolean {
  for (const command of commands) {
    if (command.type === 'moveNode') continue
    if (command.type === 'batch') {
      if (requiresLayoutAfter(command.commands)) return true
      continue
    }
    return true
  }
  return false
}

/**
 * Apply a command batch atomically: on failure the original document is
 * returned untouched (the success envelope carries history/layout gates).
 */
export function applyDocumentCommands(
  document: MindmapDocument,
  commands: MindmapCommand[],
): CommandBatchResult {
  let current = document
  for (const command of commands) {
    const result = applyDocumentCommand(current, command)
    if (!result.ok) return result
    current = result.document
  }
  return {
    ok: true,
    document: current,
    recordHistory: shouldRecordHistory(commands),
    reflow: requiresLayoutAfter(commands),
  }
}
