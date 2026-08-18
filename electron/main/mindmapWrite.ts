import crypto from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { IPC, type MindmapWriteRequest, type MindmapWriteResponse } from '../ipc.js'

const WRITE_TIMEOUT_MS = 3000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Main-process → renderer write requester (reuses the mindmap-read channel
 * pattern).
 *
 * The request is sent via `webContents.send`; the renderer ack is received via
 * `ipcMain.handle`. requestId correlates concurrent runners; a timeout or an
 * unknown requestId is treated as failure (the error is returned to the model,
 * no retry). The renderer ack `{ok, action, data}` is passed through as-is;
 * `ok: false` becomes a tool error.
 */
export class MindmapWriteRequester {
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  request(fileUuid: string, action: string, args: Record<string, unknown>): Promise<unknown> {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) {
      return Promise.reject(new Error('编辑器不可用（窗口已关闭），无法落盘'))
    }
    const requestId = crypto.randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`落盘超时（${WRITE_TIMEOUT_MS / 1000}s 内未收到渲染层应答）`))
      }, WRITE_TIMEOUT_MS)
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
      })
      const request: MindmapWriteRequest = { requestId, fileUuid, action, args }
      window.webContents.send(IPC.AiMindmapWriteRequest, request)
    })
  }

  respond(payload: MindmapWriteResponse): void {
    const entry = this.pending.get(payload.requestId)
    if (!entry) return
    this.pending.delete(payload.requestId)
    clearTimeout(entry.timer)
    if (!payload.ok) {
      entry.reject(new Error(payload.error))
      return
    }
    // The renderer ack passes through as-is (requestId is an internal
    // correlation id and never enters the tool result):
    // write tools return the whole {ok, action, data} envelope as the ToolMessage.
    entry.resolve({ ok: true as const, action: payload.action, data: payload.data })
  }

  /** Number of pending requests (test/observation helper). */
  get pendingCount(): number {
    return this.pending.size
  }
}
