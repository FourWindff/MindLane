import type { BrowserWindow } from 'electron'
import {
  IPC,
  type MindmapReadQuery,
  type MindmapReadRequest,
  type MindmapReadResponse,
} from '../ipc.js'
import { RendererRequester } from './rendererRequester.js'

const REQUEST_TIMEOUT_MS = 3000

/**
 * Main-process → renderer requester for the live-apply reverse channel.
 *
 * Only the `readMindmap` tool uses it (it returns a mindmap-section XML
 * fragment). Writes are local: they call the document service directly, so
 * there is no write channel, no ack and no timeout on that side. `win` is a
 * module-level mutable reference (the window can be recreated), so the getter
 * fails a destroyed window's request immediately instead of hanging.
 */
export function createMindmapReadRequester(
  getWindow: () => BrowserWindow | null,
): RendererRequester<MindmapReadRequest, MindmapReadResponse> {
  return new RendererRequester<MindmapReadRequest, MindmapReadResponse>(
    getWindow,
    (window, request) => window.webContents.send(IPC.AiMindmapReadRequest, request),
    REQUEST_TIMEOUT_MS,
    'Read mindmap',
    'response',
    (payload) => payload.summary,
  )
}

/** Read request body; an empty query is omitted so the renderer defaults to summary mode. */
export function buildMindmapReadRequest(
  fileUuid: string,
  query: MindmapReadQuery = {},
): Omit<MindmapReadRequest, 'requestId'> {
  return { fileUuid, ...(query && Object.keys(query).length > 0 ? { query } : {}) }
}
