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
 * 主进程 → 渲染层的落盘请求器（复用 mindmap-read 通道模式）。
 *
 * 经 `webContents.send` 发出请求事件、经 `ipcMain.handle` 接收渲染层应答 invoke；
 * requestId 关联并发 runner；超时或未知 requestId 按失败处理（错误回模型，不重试）。
 * 渲染层应答 `{ok, action, data}` 原样透出，`ok: false` 转成工具错误。
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
    // 渲染层应答原样透出（requestId 是内部关联，不进工具结果）：
    // 写工具把 {ok, action, data} 整体作为 ToolMessage 回给模型。
    entry.resolve({ ok: true as const, action: payload.action, data: payload.data })
  }

  /** 当前未决请求数（测试与观测用）。 */
  get pendingCount(): number {
    return this.pending.size
  }
}
