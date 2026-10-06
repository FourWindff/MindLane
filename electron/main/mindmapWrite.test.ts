import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { buildMindmapWriteRequest, createMindmapWriteRequester } from './mindmapRequesters.js'

/** Fake BrowserWindow: records outgoing requests only, and never reaches the renderer. */
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

  it('sends the request with requestId + fileUuid + action + args and resolves the renderer ack as-is', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request(() =>
      buildMindmapWriteRequest('file-a', 'insertXmlFragment', { xml: '<node/>' }),
    )
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
    // The renderer response {ok, action, data} passes through verbatim (requestId is internal correlation and is not part of the result)
    await expect(promise).resolves.toEqual({
      ok: true,
      action: 'insertXmlFragment',
      data: { nodeCount: 1 },
    })
    expect(requester.pendingCount).toBe(0)
  })

  it('clears the request timer once the renderer answers (no dangling timer per request)', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request(() =>
      buildMindmapWriteRequest('file-a', 'insertXmlFragment', { xml: '<node/>' }),
    )
    expect(vi.getTimerCount()).toBe(1)

    requester.respond({
      requestId: sent[0]!.requestId,
      ok: true,
      action: 'insertXmlFragment',
      data: { nodeCount: 1 },
    })
    await expect(promise).resolves.toEqual({
      ok: true,
      action: 'insertXmlFragment',
      data: { nodeCount: 1 },
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with the renderer error when the response signals failure', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request(() =>
      buildMindmapWriteRequest('file-a', 'updateMindmapNode', {}),
    )
    requester.respond({
      requestId: sent[0]!.requestId,
      ok: false,
      error: '[block_not_found] Node not found',
    })

    await expect(promise).rejects.toThrow('[block_not_found] Node not found')
  })

  it('ignores responses for unknown requestIds (already timed out / answered)', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request(() => buildMindmapWriteRequest('file-a', 'deleteNode', {}))
    requester.respond({ requestId: 'unknown', ok: true, action: 'x', data: null })
    expect(requester.pendingCount).toBe(1)

    requester.respond({
      requestId: sent[0]!.requestId,
      ok: true,
      action: 'deleteMindmapNode',
      data: { deleted: true },
    })
    await expect(promise).resolves.toEqual({
      ok: true,
      action: 'deleteMindmapNode',
      data: { deleted: true },
    })
  })

  it('correlates concurrent requests so parallel tools do not cross wires', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promiseA = requester.request(() =>
      buildMindmapWriteRequest('file-a', 'insertXmlFragment', { xml: 'A' }),
    )
    const promiseB = requester.request(() =>
      buildMindmapWriteRequest('file-a', 'updateMindmapNode', { xml: 'B' }),
    )
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

    await expect(promiseA).resolves.toEqual({
      ok: true,
      action: 'insertXmlFragment',
      data: { a: true },
    })
    await expect(promiseB).resolves.toEqual({
      ok: true,
      action: 'updateMindmapNode',
      data: { b: true },
    })
  })

  it('times out with a clear error', async () => {
    const { window } = fakeWindow()
    const requester = createMindmapWriteRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request(() =>
      buildMindmapWriteRequest('file-a', 'insertXmlFragment', {}),
    )
    const assertion = expect(promise).rejects.toThrow(
      'Save to disk timed out (no ack from the renderer within 3s)',
    )
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    expect(requester.pendingCount).toBe(0)
  })

  it('rejects immediately when the window is unavailable (file closed / app window gone)', async () => {
    const requester = createMindmapWriteRequester(() => null)

    await expect(
      requester.request(() => buildMindmapWriteRequest('file-a', 'insertXmlFragment', {})),
    ).rejects.toThrow('Editor is unavailable (the window is closed); cannot save to disk')
  })
})
