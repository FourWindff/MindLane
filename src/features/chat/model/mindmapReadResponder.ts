import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { serializeMindmapSection } from '@contracts/mindmapXml'
import type { MindmapReadQuery, MindmapReadRequest } from '@contracts/ipc'

/**
 * Renderer-side mindmap read responder: registered once at app start-up.
 *
 * The main process sends requests over the reverse channel (requestId + fileUuid
 * + query); this responder resolves the matching editor by fileUuid and replies
 * with the mindmap section XML serialized from the **editor's live state**
 * (never read from disk); only the mindmap section is exposed (metadata, assets
 * and documents stay out of the AI context). When the file is not open it fails
 * explicitly instead of hanging. Concurrent runners each carry their own
 * fileUuid and requestId, so simultaneous generation across files never
 * interferes.
 */
export function connectMindmapReadResponder(): () => void {
  const api = window.mindlane?.ai
  if (!api?.onMindmapReadRequest || !api.respondMindmapRead) {
    return () => {}
  }
  return api.onMindmapReadRequest((request) => {
    void respondMindmapRead(request)
  })
}

async function respondMindmapRead(request: MindmapReadRequest): Promise<void> {
  const api = window.mindlane?.ai
  if (!api?.respondMindmapRead) return

  const instance = openFileRegistry.getByFileUuid(request.fileUuid)
  if (!instance) {
    await api.respondMindmapRead({
      requestId: request.requestId,
      ok: false,
      error: 'This file is not open, cannot read the mindmap',
    })
    return
  }

  const state = instance.store.getState()
  if (!state.hasDocumentOpen || !state.filePath) {
    await api.respondMindmapRead({
      requestId: request.requestId,
      ok: false,
      error: 'This file is not open, cannot read the mindmap',
    })
    return
  }

  const query = (request.query ?? {}) as MindmapReadQuery

  const summary = serializeMindmapSection(state.nodes, state.edges, {
    ...(query.scope === 'subtree' && query.subtreeId ? { subtreeId: query.subtreeId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.textContains ? { textContains: query.textContains } : {}),
    ...(typeof query.maxDepth === 'number' ? { maxDepth: query.maxDepth } : {}),
  })
  await api.respondMindmapRead({ requestId: request.requestId, ok: true, summary })
}
