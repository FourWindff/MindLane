/**
 * Test-only document transport: an in-memory loopback to the real main-process
 * document service. Tests drive the renderer exactly like the bridge does —
 * send an intent, receive a versioned state — without starting a window.
 *
 * Never imported by production code (the `.testutil.ts` suffix keeps it out of
 * the boundary scans and the app bundle).
 */

import { MindmapDocumentService } from '../../../../electron/main/document/documentService'
import type { MindmapDocumentState } from '@contracts/mindmapDocument/state'
import { setDocumentTransport, type MindmapDocumentTransport } from './documentClient'

const listeners = new Set<(state: MindmapDocumentState) => void>()

function createService(): MindmapDocumentService {
  const service = new MindmapDocumentService()
  service.subscribe((state) => {
    for (const listener of listeners) listener(state)
  })
  return service
}

let service = createService()

const transport: MindmapDocumentTransport = {
  send(intent) {
    return service.handle(intent)
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** The in-memory document service backing the loopback (assertions on the authoritative value). */
export function getDocumentLoopbackService(): MindmapDocumentService {
  return service
}

/** The loopback transport itself (tests may wrap it to record intents). */
export function getDocumentLoopbackTransport(): MindmapDocumentTransport {
  return transport
}

/** Install the loopback as the renderer transport (the bridge is never used in tests). */
export function installDocumentLoopback(): void {
  setDocumentTransport(transport)
}

/** Throw away every document instance between tests (history, versions, instances). */
export function resetDocumentLoopback(): void {
  service = createService()
  listeners.clear()
}
