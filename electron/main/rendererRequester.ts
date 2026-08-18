import crypto from 'node:crypto'
import type { BrowserWindow } from 'electron'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface RequesterRequest {
  requestId: string
}

export interface RequesterResponse {
  requestId: string
  ok: boolean
  error?: string
}

/**
 * Generic main-process → renderer request/ack bridge, shared by the read and
 * write live-apply channels so the pending-map, timeout, and correlation logic
 * lives in exactly one place.
 *
 * The request is sent via `webContents.send`; the ack is received via
 * `ipcMain.handle`. requestId correlates concurrent runners; a timeout or an
 * unknown requestId is treated as failure (the error is returned to the model,
 * no retry). `resolveOk` translates a success ack into the promise's value;
 * `verb`/`ackNoun` only feed the model-facing error text.
 */
export class RendererRequester<TReq extends RequesterRequest, TRes extends RequesterResponse> {
  private readonly pending = new Map<string, PendingRequest>()

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly send: (window: BrowserWindow, request: TReq) => void,
    private readonly timeoutMs: number,
    private readonly verb: string,
    private readonly ackNoun: string,
    private readonly resolveOk: (payload: Extract<TRes, { ok: true }>) => unknown,
  ) {}

  request<T>(buildRequest: (requestId: string) => Omit<TReq, 'requestId'>): Promise<T> {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) {
      return Promise.reject(new Error(`编辑器不可用（窗口已关闭），无法${this.verb}`))
    }
    const requestId = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(
          new Error(`${this.verb}超时（${this.timeoutMs / 1000}s 内未收到渲染层${this.ackNoun}）`),
        )
      }, this.timeoutMs)
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
        timer,
      })
      const request = { requestId, ...buildRequest(requestId) } as TReq
      this.send(window, request)
    })
  }

  respond(payload: TRes): void {
    const entry = this.pending.get(payload.requestId)
    if (!entry) return
    this.pending.delete(payload.requestId)
    clearTimeout(entry.timer)
    if (!payload.ok) {
      entry.reject(new Error(payload.error))
      return
    }
    // After the !ok early return above, payload is the ok variant (generic
    // unions do not narrow through Extract automatically).
    entry.resolve(this.resolveOk(payload as Extract<TRes, { ok: true }>))
  }

  /** Current number of pending requests (test/observation helper). */
  get pendingCount(): number {
    return this.pending.size
  }
}
