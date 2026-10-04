import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { MindmapReadQuery } from '../../ipc.js'

export type { MindmapReadQuery }

/**
 * Mindmap snapshot provider: pulls the live mindmap XML by fileUuid + query
 * params. Injected by the assembler (the main process requests it from the
 * renderer over reverse IPC); the tool itself never touches IPC - the same
 * pattern as the readFile tool's getter injection, which keeps the tool
 * stateless and unit-testable.
 */
type MindmapSnapshotProvider = (fileUuid: string, query: MindmapReadQuery) => Promise<string>

/**
 * Create the on-demand mindmap read tool (PRD 6.2, reworked from
 * getMindmapContext).
 * Tree queries: scope/subtreeId/type/textContains/maxDepth; the data source is
 * the editor's live state (pulled over reverse IPC, never read from disk); the
 * output holds only the mindmap section XML (metadata/assets/documents never
 * enter the AI context).
 *
 * Semantics: write tools land as soon as they execute (the renderer's live
 * editor applies immediately), so once a write succeeds (result ok: true) this
 * tool can see the freshly written nodes; on failure, follow the recovery
 * strategy named by the error code (e.g. block_not_found → call readMindmap
 * first to re-locate).
 */
export function createReadMindmapTool(provider: MindmapSnapshotProvider) {
  return tool(
    async ({ fileUuid, scope, subtreeId, type, textContains, maxDepth }) => {
      try {
        const summary = await provider(fileUuid ?? '', {
          scope: scope ?? 'whole',
          ...(subtreeId && { subtreeId }),
          ...(type && { type }),
          ...(textContains && { textContains }),
          ...(typeof maxDepth === 'number' && Number.isFinite(maxDepth) && { maxDepth }),
        })
        return { ok: true, summary }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
    {
      name: 'readMindmap',
      description: `Read the live structure of the current mindmap (an XML fragment carrying id/type/content/collapsed), to answer "what is in my mindmap" and to locate the nodes to edit. The data source is the editor's live state, not a file on disk. fileUuid is available from the file_uuid attribute of the <EDITOR_STATE> block at the end of the current user message (shaped like <EDITOR_STATE file_uuid="...">). Note: write tools (insertXmlFragment / updateMindmapNode / moveMindmapNode / deleteMindmapNode) land as soon as they execute - once a write succeeds (result ok: true) this tool sees the freshly written nodes; on failure (e.g. block_not_found) follow the recovery strategy in the error message, which usually means calling readMindmap first to re-locate.`,
      schema: z.object({
        fileUuid: z
          .string()
          .optional()
          .describe(
            'Mindmap file identity, fileUuid, available from <EDITOR_STATE file_uuid="..."> at the end of the user message',
          ),
        scope: z
          .enum(['whole', 'subtree'])
          .optional()
          .describe(
            'Query scope: whole=the entire mindmap (default), subtree=the subtree rooted at subtreeId',
          ),
        subtreeId: z
          .string()
          .optional()
          .describe('Subtree root node id when scope=subtree (must come from the context)'),
        type: z.string().optional().describe('Filter by node type (text/image/palace)'),
        textContains: z
          .string()
          .optional()
          .describe('Filter by node content containment (plain-text match)'),
        maxDepth: z.number().optional().describe('Depth truncation (0=return the root only)'),
      }),
    },
  )
}
