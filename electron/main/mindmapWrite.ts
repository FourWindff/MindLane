import type { BrowserWindow } from 'electron'
import {
  IPC,
  type MindmapWriteRequest,
  type MindmapWriteResponse,
  type WriteAction,
} from '../ipc.js'
import { RendererRequester } from './rendererRequester.js'

const WRITE_TIMEOUT_MS = 3000

/**
 * Main-process → renderer write requester (reuses the mindmap-read channel
 * pattern via the shared RendererRequester).
 *
 * The renderer ack `{ok, action, data}` is passed through as-is; `ok: false`
 * becomes a tool error. The full envelope is returned to the model as the
 * ToolMessage.
 */
export class MindmapWriteRequester {
  private readonly inner: RendererRequester<MindmapWriteRequest, MindmapWriteResponse>

  constructor(getWindow: () => BrowserWindow | null) {
    this.inner = new RendererRequester<MindmapWriteRequest, MindmapWriteResponse>(
      getWindow,
      IPC.AiMindmapWriteRequest,
      WRITE_TIMEOUT_MS,
      '落盘',
      '应答',
      (payload) => ({ ok: true as const, action: payload.action, data: payload.data }),
    )
  }

  request(fileUuid: string, action: WriteAction, args: Record<string, unknown>): Promise<unknown> {
    return this.inner.request<unknown>(() => ({ fileUuid, action, args }))
  }

  respond(payload: MindmapWriteResponse): void {
    this.inner.respond(payload)
  }

  /** Current number of pending requests (test/observation helper). */
  get pendingCount(): number {
    return this.inner.pendingCount
  }
}
