/**
 * The `readMindmap` tool's data source: the authoritative document, read
 * straight out of the document service.
 *
 * There is no renderer round trip here: a minimized, busy or destroyed window
 * cannot fail a read, and the tool sees the same versioned document the write
 * tools mutate.
 */

import { serializeMindmapSection } from '../../../contracts/mindmapXml/serializer.js'
import type { MindmapReadQuery } from '../../../contracts/ipc.js'
import type { MindmapDocumentService } from './documentService.js'

/**
 * Serialize the mindmap section of one open file (tree query applied).
 * Throws when the file is not open: the tool turns that into a model-facing
 * error instead of waiting on a channel that no longer exists.
 */
export function readMindmapSection(
  documentService: MindmapDocumentService,
  fileUuid: string,
  query: MindmapReadQuery = {},
): string {
  const document = documentService.getDocument(fileUuid)
  if (!document) {
    throw new Error('This file is not open, cannot read the mindmap')
  }

  return serializeMindmapSection(document.nodes, document.edges, {
    ...(query.scope === 'subtree' && query.subtreeId ? { subtreeId: query.subtreeId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.textContains ? { textContains: query.textContains } : {}),
    ...(typeof query.maxDepth === 'number' ? { maxDepth: query.maxDepth } : {}),
  })
}
