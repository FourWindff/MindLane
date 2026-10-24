import type { BrowserWindow } from 'electron'
import {
  IPC,
  type MindmapWriteRequest,
  type MindmapWriteResponse,
  type WriteAction,
} from '../ipc.js'
import { RendererRequester } from './rendererRequester.js'

const REQUEST_TIMEOUT_MS = 3000

/**
 * Main-process → renderer requester for the live-apply write channel: the ack
 * `{ok, action, data}` is passed through as-is. `win` is a module-level mutable
 * reference (the window can be recreated), so it takes a getter: a destroyed
 * window fails the request immediately instead of hanging.
 */
export function createMindmapWriteRequester(
  getWindow: () => BrowserWindow | null,
): RendererRequester<MindmapWriteRequest, MindmapWriteResponse> {
  return new RendererRequester<MindmapWriteRequest, MindmapWriteResponse>(
    getWindow,
    (window, request) => window.webContents.send(IPC.AiMindmapWriteRequest, request),
    REQUEST_TIMEOUT_MS,
    'Save to disk',
    'ack',
    (payload) => ({ ok: true as const, action: payload.action, data: payload.data }),
  )
}

export function buildMindmapWriteRequest(
  fileUuid: string,
  action: WriteAction,
  args: Record<string, unknown>,
): Omit<MindmapWriteRequest, 'requestId'> {
  return { fileUuid, action, args }
}
