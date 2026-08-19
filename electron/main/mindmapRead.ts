import type { BrowserWindow } from 'electron'
import {
  IPC,
  type MindmapReadQuery,
  type MindmapReadRequest,
  type MindmapReadResponse,
} from '../ipc.js'
import { RendererRequester } from './rendererRequester.js'

const READ_TIMEOUT_MS = 3000

/**
 * Main-process → renderer on-demand read requester (live-apply reverse channel).
 *
 * Only the `readMindmap` read tool uses it (returns a mindmap-section XML
 * fragment); write validation/apply moved to the renderer with live apply (see
 * MindmapWriteRequester), so no snapshot mode is needed.
 */
export class MindmapReadRequester {
  private readonly inner: RendererRequester<MindmapReadRequest, MindmapReadResponse>

  constructor(getWindow: () => BrowserWindow | null) {
    this.inner = new RendererRequester<MindmapReadRequest, MindmapReadResponse>(
      getWindow,
      (window, request) => window.webContents.send(IPC.AiMindmapReadRequest, request),
      READ_TIMEOUT_MS,
      '读取导图',
      '响应',
      (payload) => payload.summary,
    )
  }

  request(fileUuid: string, query: MindmapReadQuery = {}): Promise<string> {
    return this.inner.request(() => ({
      fileUuid,
      ...(query && Object.keys(query).length > 0 ? { query } : {}),
    }))
  }

  respond(payload: MindmapReadResponse): void {
    this.inner.respond(payload)
  }

  /** Current number of pending requests (test/observation helper). */
  get pendingCount(): number {
    return this.inner.pendingCount
  }
}
