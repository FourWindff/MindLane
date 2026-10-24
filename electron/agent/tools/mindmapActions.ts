import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { MindmapWrite, WriteAction } from '../../../contracts/mindmapDocument/writeAction.js'

/**
 * AI write tool set (fixed 4, PRD 6.1): insertXmlFragment / updateMindmapNode /
 * moveMindmapNode / deleteMindmapNode. The set does not grow with node types —
 * type knowledge lives in the registry validation + system-prompt injection.
 *
 * The tools call the document write service locally: validation and landing
 * happen in the main process, so a minimized window or a busy renderer cannot
 * fail a write. The ack `{ok, action, data}` (or `{ok, error}`) is the tool
 * result verbatim; the error goes back to the model and the stream continues,
 * with no added retry. Model-visible contracts (tool name/description/schema)
 * are unchanged.
 */

/** Unified error wrapping: unexpected executor failure → tool failure result. */
function asToolError(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

/** Runs one local write and normalizes the outcome into a tool result. */
function runWrite(
  write: MindmapWrite,
  fileUuid: string | undefined,
  action: WriteAction,
  args: Record<string, unknown>,
  adapt: (result: unknown) => unknown = (result) => result,
): Promise<unknown> {
  return write(fileUuid ?? '', action, args)
    .then(adapt)
    .catch((err) => adapt(asToolError(err)))
}

/**
 * ADR-0023: the criterion "short content self-written / documents or long text via
 * the mindmap subgraph" lives in the subgraph tool's description. When a self-written
 * fragment fails anyway, the failure feedback carries the correction path.
 */
const LONG_CONTENT_CORRECTION =
  'If the content is long, generate it with generateMindmapFragment and then insert it.'

/** Appends the long-content correction to an insertXmlFragment failure (success acks pass through). */
function withLongContentCorrection(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result
  const ack = result as { ok?: unknown; error?: unknown }
  if (ack.ok !== false || typeof ack.error !== 'string') return result
  return { ...ack, error: `${ack.error}. ${LONG_CONTENT_CORRECTION}` }
}

// ========== insertXmlFragment (unified write entry) ==========

/**
 * Creates the unified write-entry tool: inserts a nested XML fragment at any
 * position (including batched subtree generation).
 * position: root=attach under the root / child=attach under targetId /
 * after|before=become a sibling of targetId.
 * Validation and landing both happen in the document service (one atomic op).
 */
function createInsertXmlFragmentTool(write: MindmapWrite) {
  return tool(
    async ({ fileUuid, xml, targetId, position }) =>
      runWrite(
        write,
        fileUuid,
        'insertXmlFragment',
        { xml, targetId, position },
        withLongContentCorrection,
      ),
    {
      name: 'insertXmlFragment',
      description: `Insert an XML fragment into the mindmap (nested subtree, batching supported). position: child=attach under targetId (default); after/before=insert before/after the sibling targetId; root=attach under the root node. When targetId is omitted the fragment lands under the root node. Rules: new nodes must not carry an id (the system mints it); type is required (text/image/palace); content is a plain-text attribute whose special characters must be escaped; an image node must reference an asset from the context. fileUuid is available from <EDITOR_STATE file_uuid="..."> at the end of the user message.`,
      schema: z.object({
        fileUuid: z.string().optional().describe('Mindmap file identity, fileUuid'),
        xml: z
          .string()
          .describe('XML fragment to insert (several top-level <node> elements = batched insert)'),
        targetId: z
          .string()
          .optional()
          .describe(
            'Anchor node id: the parent when position=child, the sibling when position=after/before',
          ),
        position: z
          .enum(['root', 'child', 'after', 'before'])
          .optional()
          .describe('Insert position (default child)'),
      }),
    },
  )
}

// ========== updateMindmapNode (whole replacement, args switched to XML) ==========

/**
 * Creates the update tool: replaces the node wholesale (with subtree) from an
 * XML arg. Validation and landing happen in the document service.
 */
function createUpdateMindmapNodeTool(write: MindmapWrite) {
  return tool(
    async ({ fileUuid, xml }) => runWrite(write, fileUuid, 'updateMindmapNode', { xml }),
    {
      name: 'updateMindmapNode',
      description: `Replace a mindmap node wholesale (content/type/subtree). The xml argument is a single root <node> whose id must be an existing node id provided by readMindmap; the node itself takes the shape of the new XML and its old subtree is replaced entirely by the new subtree. root cannot be replaced. fileUuid is available from <EDITOR_STATE file_uuid="..."> at the end of the user message.`,
      schema: z.object({
        fileUuid: z.string().optional().describe('Mindmap file identity, fileUuid'),
        xml: z.string().describe('XML for a single root <node> (id references an existing node)'),
      }),
    },
  )
}

// ========== moveMindmapNode (detach + re-attach + re-layout) ==========

/**
 * Creates the move tool: detaches the subtree, re-attaches it and re-layouts
 * (single batch history entry, atomic). Validation (root immovable; target
 * must not live inside the moved subtree) happens in the document service.
 */
function createMoveMindmapNodeTool(write: MindmapWrite) {
  return tool(
    async ({ fileUuid, nodeId, targetId, position }) =>
      runWrite(write, fileUuid, 'moveMindmapNode', { nodeId, targetId, position }),
    {
      name: 'moveMindmapNode',
      description: `Move a node (with its whole subtree) to a new position, atomically (one undo restores it). position: child=become a child of targetId (default); after/before=become a sibling of targetId. root cannot be moved; a node cannot move inside its own subtree. fileUuid is available from <EDITOR_STATE file_uuid="..."> at the end of the user message.`,
      schema: z.object({
        fileUuid: z.string().optional().describe('Mindmap file identity, fileUuid'),
        nodeId: z.string().describe('Id of the node to move (with its subtree)'),
        targetId: z.string().optional().describe('Target node id (default root)'),
        position: z
          .enum(['child', 'after', 'before'])
          .optional()
          .describe('Insert position relative to the target (default child)'),
      }),
    },
  )
}

// ========== deleteMindmapNode (kept) ==========

/**
 * Creates the delete tool: deletes the node (with its subtree). The action name
 * matches the tool name (the document write service applies by that name).
 */
function createDeleteMindmapNodeTool(write: MindmapWrite) {
  return tool(
    async ({ fileUuid, nodeId, confirmDeleteSubtree }) =>
      runWrite(write, fileUuid, 'deleteMindmapNode', { nodeId, confirmDeleteSubtree }),
    {
      name: 'deleteMindmapNode',
      description:
        'Delete the given mindmap node (with its whole subtree). nodeId must be an id provided by readMindmap; root cannot be deleted. fileUuid is available from <EDITOR_STATE file_uuid="..."> at the end of the user message.',
      schema: z.object({
        fileUuid: z.string().optional().describe('Mindmap file identity, fileUuid'),
        nodeId: z.string().describe('Id of the node to delete (with its subtree)'),
        confirmDeleteSubtree: z
          .boolean()
          .optional()
          .describe('Whether to confirm deleting the subtree; defaults to true'),
      }),
    },
  )
}

/** Creates the fixed 4 write tools (local document writes). */
export function createMindmapActionTools(write: MindmapWrite) {
  return {
    insertXmlFragmentTool: createInsertXmlFragmentTool(write),
    updateNodeTool: createUpdateMindmapNodeTool(write),
    moveNodeTool: createMoveMindmapNodeTool(write),
    deleteNodeTool: createDeleteMindmapNodeTool(write),
  }
}
