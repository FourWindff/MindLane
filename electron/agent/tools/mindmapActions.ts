import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { WriteAction } from '../../ipc.js'

/**
 * AI write tool set (fixed 4, PRD 6.1): insertXmlFragment / updateMindmapNode /
 * moveMindmapNode / deleteMindmapNode. The set does not grow with node types —
 * type knowledge lives in the registry validation + system-prompt injection.
 *
 * Renderer proxy (ADR 0017 decision 1): the main-process tools no longer do
 * snapshot validation; they forward the tool args over reverse IPC to the
 * renderer write responder (live-editor atomic validation + apply) and return
 * the renderer ack `{ok, action, data}` **as-is** as the tool result. No
 * renderer response / timeout is treated as tool failure (error goes back to
 * the model, the stream continues), with no added retry. Model-visible
 * contracts (tool name/description/schema) stay unchanged.
 */

/** Write-tool renderer proxy: forwards args and returns the renderer's write ack (as-is). */
export type MindmapWriteProxy = (
  fileUuid: string,
  action: WriteAction,
  args: Record<string, unknown>,
) => Promise<unknown>

/** Unified error wrapping: timeout / renderer ok:false / unavailable window → tool failure result. */
function asToolError(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

/** Forwards one renderer write and normalizes the outcome into a tool result. */
function runWrite(
  proxy: MindmapWriteProxy,
  fileUuid: string | undefined,
  action: WriteAction,
  args: Record<string, unknown>,
  adapt: (result: unknown) => unknown = (result) => result,
): Promise<unknown> {
  return proxy(fileUuid ?? '', action, args)
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
 * position: root=attach under the root / child=attach under parentId /
 * after|before=become a sibling of parentId.
 * Validation and apply both happen inside the renderer responder (atomic live-editor op).
 */
function createInsertXmlFragmentTool(proxy: MindmapWriteProxy) {
  return tool(
    async ({ fileUuid, xml, parentId, position }) =>
      runWrite(
        proxy,
        fileUuid,
        'insertXmlFragment',
        { xml, parentId, position },
        withLongContentCorrection,
      ),
    {
      name: 'insertXmlFragment',
      description: `Insert an XML fragment into the mindmap (nested subtree, batching supported). position: child=attach under parentId (default); after/before=insert before/after the sibling parentId; root=attach under the root node. When parentId is omitted the target falls back from the selected node to the root node. Rules: new nodes must not carry an id (the system mints it); type is required (text/image/palace); content is a plain-text attribute whose special characters must be escaped; an image node must reference an asset from the context. fileUuid is available from <EDITOR_STATE file_uuid="..."> at the end of the user message.`,
      schema: z.object({
        fileUuid: z.string().optional().describe('Mindmap file identity, fileUuid'),
        xml: z
          .string()
          .describe('XML fragment to insert (several top-level <node> elements = batched insert)'),
        parentId: z
          .string()
          .optional()
          .describe(
            'Parent node id when position=child; sibling node id when position=after/before',
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
 * XML arg. Validation and apply happen inside the renderer responder.
 */
function createUpdateMindmapNodeTool(proxy: MindmapWriteProxy) {
  return tool(
    async ({ fileUuid, xml }) => runWrite(proxy, fileUuid, 'updateMindmapNode', { xml }),
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
 * must not live inside the moved subtree) happens in the renderer responder.
 */
function createMoveMindmapNodeTool(proxy: MindmapWriteProxy) {
  return tool(
    async ({ fileUuid, nodeId, targetId, position }) =>
      runWrite(proxy, fileUuid, 'moveMindmapNode', { nodeId, targetId, position }),
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
 * Creates the delete tool: deletes the node (with its subtree). The action
 * name stays `deleteNode` (the renderer responder applies by that name).
 */
function createDeleteMindmapNodeTool(proxy: MindmapWriteProxy) {
  return tool(
    async ({ fileUuid, nodeId, confirmDeleteSubtree }) =>
      runWrite(proxy, fileUuid, 'deleteNode', { nodeId, confirmDeleteSubtree }),
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

/** Creates the fixed 4 write tools (renderer proxies). */
export function createMindmapActionTools(proxy: MindmapWriteProxy) {
  return {
    insertXmlFragmentTool: createInsertXmlFragmentTool(proxy),
    updateNodeTool: createUpdateMindmapNodeTool(proxy),
    moveNodeTool: createMoveMindmapNodeTool(proxy),
    deleteNodeTool: createDeleteMindmapNodeTool(proxy),
  }
}
