import crypto from 'node:crypto'
import type { BrowserWindow } from 'electron'
import {
  IPC,
  type MindmapReadQuery,
  type MindmapReadRequest,
  type MindmapReadResponse,
} from '../ipc.js'

const READ_TIMEOUT_MS = 3000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * 主进程 → 渲染层的按需读导图请求器。
 *
 * 经 `webContents.send` 发出请求事件、经 `ipcMain.handle` 接收渲染层应答 invoke；
 * requestId 关联并发 runner（多文件同时生成互不干扰），
 * 超时（约 3s）或缺窗口把缺失/挂起的响应转成明确的工具错误。
 *
 * 仅 `readMindmap` 读工具使用（返回 mindmap 节 XML 片段）；写工具的校验与落图
 * 已随即时落盘移入渲染层（走 MindmapWriteRequester），不再需要快照模式。
 */
export class MindmapReadRequester {
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  request(fileUuid: string, query: MindmapReadQuery = {}): Promise<string> {
    return this.send<string>(fileUuid, { query })
  }

  private send<T>(fileUuid: string, extra: { query?: MindmapReadQuery }): Promise<T> {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) {
      return Promise.reject(new Error('编辑器不可用（窗口已关闭），无法读取导图'))
    }
    const requestId = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`读取导图超时（${READ_TIMEOUT_MS / 1000}s 内未收到渲染层响应）`))
      }, READ_TIMEOUT_MS)
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      const request: MindmapReadRequest = {
        requestId,
        fileUuid,
        ...(extra.query && Object.keys(extra.query).length > 0 ? { query: extra.query } : {}),
      }
      window.webContents.send(IPC.AiMindmapReadRequest, request)
    })
  }

  respond(payload: MindmapReadResponse): void {
    const entry = this.pending.get(payload.requestId)
    if (!entry) return
    this.pending.delete(payload.requestId)
    if (!payload.ok) {
      entry.reject(new Error(payload.error))
      return
    }
    entry.resolve(payload.summary)
  }

  /** 当前未决请求数（测试与观测用）。 */
  get pendingCount(): number {
    return this.pending.size
  }
}
