import type { BrowserWindow } from 'electron'
import {
  IPC,
  type MindmapReadQuery,
  type MindmapReadRequest,
  type MindmapReadResponse,
  type MindmapWriteRequest,
  type MindmapWriteResponse,
  type WriteAction,
} from '../ipc.js'
import { RendererRequester } from './rendererRequester.js'

const REQUEST_TIMEOUT_MS = 3000

/**
 * Main-process → renderer requesters for the live-apply reverse channels.
 *
 * Only the `readMindmap` tool uses the read channel (returns a mindmap-section
 * XML fragment); only live-apply write tools use the write channel (the ack
 * `{ok, action, data}` is passed through as-is). `win` is a module-level mutable
 * reference (the window can be recreated), so both take a getter: a destroyed
 * window fails the request immediately instead of hanging.
 */
export function createMindmapReadRequester(
  getWindow: () => BrowserWindow | null,
): RendererRequester<MindmapReadRequest, MindmapReadResponse> {
  return new RendererRequester<MindmapReadRequest, MindmapReadResponse>(
    getWindow,
    (window, request) => window.webContents.send(IPC.AiMindmapReadRequest, request),
    REQUEST_TIMEOUT_MS,
    '读取导图',
    '响应',
    (payload) => payload.summary,
  )
}

export function createMindmapWriteRequester(
  getWindow: () => BrowserWindow | null,
): RendererRequester<MindmapWriteRequest, MindmapWriteResponse> {
  return new RendererRequester<MindmapWriteRequest, MindmapWriteResponse>(
    getWindow,
    (window, request) => window.webContents.send(IPC.AiMindmapWriteRequest, request),
    REQUEST_TIMEOUT_MS,
    '落盘',
    '应答',
    (payload) => ({ ok: true as const, action: payload.action, data: payload.data }),
  )
}

/** Read request body; an empty query is omitted so the renderer defaults to summary mode. */
export function buildMindmapReadRequest(
  fileUuid: string,
  query: MindmapReadQuery = {},
): Omit<MindmapReadRequest, 'requestId'> {
  return { fileUuid, ...(query && Object.keys(query).length > 0 ? { query } : {}) }
}

export function buildMindmapWriteRequest(
  fileUuid: string,
  action: WriteAction,
  args: Record<string, unknown>,
): Omit<MindmapWriteRequest, 'requestId'> {
  return { fileUuid, action, args }
}
