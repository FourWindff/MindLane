import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { MindmapWriteRequester } from '../mindmapWrite.js'

/** 伪 BrowserWindow：只记录发出的请求，不真正触达渲染层。 */
function fakeWindow(): {
  window: unknown
  sent: Array<{
    requestId: string
    fileUuid: string
    action: string
    args: Record<string, unknown>
  }>
} {
  const sent: Array<{
    requestId: string
    fileUuid: string
    action: string
    args: Record<string, unknown>
  }> = []
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn(
        (
          _channel: string,
          payload: {
            requestId: string
            fileUuid: string
            action: string
            args: Record<string, unknown>
          },
        ) => {
          sent.push(payload)
        },
      ),
    },
  }
  return { window, sent }
}

describe('MindmapWriteRequester', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the request with requestId + fileUuid + action + args and resolves with data', async () => {
    const { window, sent } = fakeWindow()
    const requester = new MindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request('file-a', 'insertXmlFragment', { xml: '<node/>' })
    const request = sent[0]!
    expect(request.fileUuid).toBe('file-a')
    expect(request.action).toBe('insertXmlFragment')
    expect(request.args).toEqual({ xml: '<node/>' })

    requester.respond({
      requestId: request.requestId,
      ok: true,
      action: 'insertXmlFragment',
      data: { nodeCount: 1 },
    })
    await expect(promise).resolves.toEqual({ nodeCount: 1 })
    expect(requester.pendingCount).toBe(0)
  })

  it('rejects with the renderer error when the response signals failure', async () => {
    const { window, sent } = fakeWindow()
    const requester = new MindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request('file-a', 'updateMindmapNode', {})
    requester.respond({
      requestId: sent[0]!.requestId,
      ok: false,
      error: '[block_not_found] 节点不存在',
    })

    await expect(promise).rejects.toThrow('[block_not_found] 节点不存在')
  })

  it('ignores responses for unknown requestIds (already timed out / answered)', async () => {
    const { window, sent } = fakeWindow()
    const requester = new MindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request('file-a', 'deleteMindmapNode', {})
    requester.respond({ requestId: 'unknown', ok: true, action: 'x', data: null })
    expect(requester.pendingCount).toBe(1)

    requester.respond({
      requestId: sent[0]!.requestId,
      ok: true,
      action: 'deleteMindmapNode',
      data: { deleted: true },
    })
    await expect(promise).resolves.toEqual({ deleted: true })
  })

  it('correlates concurrent requests so parallel tools do not cross wires', async () => {
    const { window, sent } = fakeWindow()
    const requester = new MindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promiseA = requester.request('file-a', 'insertXmlFragment', { xml: 'A' })
    const promiseB = requester.request('file-a', 'updateMindmapNode', { xml: 'B' })
    expect(sent.map((r) => r.action)).toEqual(['insertXmlFragment', 'updateMindmapNode'])

    requester.respond({
      requestId: sent[1]!.requestId,
      ok: true,
      action: 'updateMindmapNode',
      data: { b: true },
    })
    requester.respond({
      requestId: sent[0]!.requestId,
      ok: true,
      action: 'insertXmlFragment',
      data: { a: true },
    })

    await expect(promiseA).resolves.toEqual({ a: true })
    await expect(promiseB).resolves.toEqual({ b: true })
  })

  it('times out with a clear error', async () => {
    const { window } = fakeWindow()
    const requester = new MindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request('file-a', 'insertXmlFragment', {})
    const assertion = expect(promise).rejects.toThrow('落盘超时（3s 内未收到渲染层应答）')
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    expect(requester.pendingCount).toBe(0)
  })

  it('rejects immediately when the window is unavailable (file closed / app window gone)', async () => {
    const requester = new MindmapWriteRequester(() => null)

    await expect(requester.request('file-a', 'insertXmlFragment', {})).rejects.toThrow(
      '编辑器不可用（窗口已关闭），无法落盘',
    )
  })
})
