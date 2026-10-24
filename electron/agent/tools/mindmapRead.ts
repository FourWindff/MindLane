import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { MindmapReadQuery } from '../../ipc.js'

export type { MindmapReadQuery }

/**
 * Mindmap document reader: serializes one open file's tree from the
 * authoritative document in the main process. Injected by the assembler so the
 * tool stays stateless and unit-testable - the same pattern as the readFile
 * tool's getter injection. The read is local (the document service is in this
 * process), so a busy or minimized renderer cannot fail it.
 */
type MindmapDocumentReader = (fileUuid: string, query: MindmapReadQuery) => string

/**
 * Create the on-demand mindmap read tool (PRD 6.2, reworked from
 * getMindmapContext).
 * Tree queries: scope/subtreeId/type/textContains/maxDepth; the data source is
 * the authoritative document owned by the main process (never a file on disk);
 * the output holds only the mindmap section XML (metadata/assets/documents never
 * enter the AI context).
 *
 * Semantics: write tools land as soon as they execute (the document is updated
 * in-process), so once a write succeeds (result ok: true) this tool can see the
 * freshly written nodes; on failure, follow the recovery strategy named by the
 * error code (e.g. block_not_found → call readMindmap first to re-locate).
 */
export function createReadMindmapTool(reader: MindmapDocumentReader) {
  return tool(
    async ({ fileUuid, scope, subtreeId, type, textContains, maxDepth }) => {
      try {
        const summary = reader(fileUuid ?? '', {
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
      description: `Read the live structure of the current mindmap (an XML fragment carrying id/type/content/collapsed), to answer "what is in my mindmap" and to locate the nodes to edit. The data source is the authoritative document held by the main process, not a file on disk. fileUuid is available from the file_uuid attribute of the <EDITOR_STATE> block at the end of the current user message (shaped like <EDITOR_STATE file_uuid="...">). Note: write tools (insertXmlFragment / updateMindmapNode / moveMindmapNode / deleteMindmapNode) land as soon as they execute - once a write succeeds (result ok: true) this tool sees the freshly written nodes; on failure (e.g. block_not_found) follow the recovery strategy in the error message, which usually means calling readMindmap first to re-locate.`,
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
