import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { MindmapReadRequester } from '../mindmapRead.js'

/** 伪 BrowserWindow：只记录发出的请求，不真正触达渲染层。 */
function fakeWindow(): {
  window: unknown
  sent: Array<{ requestId: string; fileUuid: string }>
} {
  const sent: Array<{ requestId: string; fileUuid: string }> = []
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn((_channel: string, payload: { requestId: string; fileUuid: string }) => {
        sent.push(payload)
      }),
    },
  }
  return { window, sent }
}

describe('MindmapReadRequester', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the summary when the renderer responds with the matching requestId', async () => {
    const { window, sent } = fakeWindow()
    const requester = new MindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request('file-a')
    const request = sent[0]!
    expect(request.fileUuid).toBe('file-a')

    requester.respond({ requestId: request.requestId, ok: true, summary: '实时树' })
    await expect(promise).resolves.toBe('实时树')
    expect(requester.pendingCount).toBe(0)
  })

  it('rejects with the renderer error when the response signals failure', async () => {
    const { window, sent } = fakeWindow()
    const requester = new MindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request('file-a')
    requester.respond({
      requestId: sent[0]!.requestId,
      ok: false,
      error: '该文件未打开，无法读取导图',
    })

    await expect(promise).rejects.toThrow('该文件未打开，无法读取导图')
  })

  it('ignores responses for unknown requestIds (already timed out / answered)', async () => {
    const { window, sent } = fakeWindow()
    const requester = new MindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request('file-a')
    requester.respond({ requestId: 'unknown', ok: true, summary: 'x' })
    // 未知 requestId 是 no-op：挂起请求仍在等待。
    expect(requester.pendingCount).toBe(1)

    requester.respond({ requestId: sent[0]!.requestId, ok: true, summary: '树' })
    await expect(promise).resolves.toBe('树')
  })

  it('correlates concurrent requests so multi-file generation does not cross wires', async () => {
    const { window, sent } = fakeWindow()
    const requester = new MindmapReadRequester(() => window as unknown as BrowserWindow)

    const promiseA = requester.request('file-a')
    const promiseB = requester.request('file-b')
    expect(sent.map((r) => r.fileUuid)).toEqual(['file-a', 'file-b'])

    requester.respond({ requestId: sent[1]!.requestId, ok: true, summary: '树 B' })
    requester.respond({ requestId: sent[0]!.requestId, ok: true, summary: '树 A' })

    await expect(promiseA).resolves.toBe('树 A')
    await expect(promiseB).resolves.toBe('树 B')
  })

  it('times out after ~3s with a clear error', async () => {
    const { window } = fakeWindow()
    const requester = new MindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request('file-a')
    // 先挂上断言处理器，避免计时器触发时出现 unhandled rejection。
    const assertion = expect(promise).rejects.toThrow('读取导图超时（3s 内未收到渲染层响应）')
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    expect(requester.pendingCount).toBe(0)
  })

  it('rejects immediately when the window is unavailable (file closed / app window gone)', async () => {
    const requester = new MindmapReadRequester(() => null)

    await expect(requester.request('file-a')).rejects.toThrow(
      '编辑器不可用（窗口已关闭），无法读取导图',
    )
  })
})
