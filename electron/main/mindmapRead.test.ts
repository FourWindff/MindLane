import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { buildMindmapReadRequest, createMindmapReadRequester } from './mindmapRequesters.js'

/** Fake BrowserWindow: records outgoing requests only, and never reaches the renderer. */
function fakeWindow(): {
  window: unknown
  sent: Array<{ requestId: string; fileUuid: string; query?: unknown }>
} {
  const sent: Array<{ requestId: string; fileUuid: string; query?: unknown }> = []
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn(
        (_channel: string, payload: { requestId: string; fileUuid: string; query?: unknown }) => {
          sent.push(payload)
        },
      ),
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
    const requester = createMindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request<string>(() => buildMindmapReadRequest('file-a'))
    const request = sent[0]!
    expect(request.fileUuid).toBe('file-a')

    requester.respond({ requestId: request.requestId, ok: true, summary: 'Live tree' })
    await expect(promise).resolves.toBe('Live tree')
    expect(requester.pendingCount).toBe(0)
  })

  it('keeps xml-mode responses as raw strings even when they look like JSON', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request<string>(() => buildMindmapReadRequest('file-a'))
    requester.respond({ requestId: sent[0]!.requestId, ok: true, summary: '{"a":1}' })

    await expect(promise).resolves.toBe('{"a":1}')
  })

  it('rejects with the renderer error when the response signals failure', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request<string>(() => buildMindmapReadRequest('file-a'))
    requester.respond({
      requestId: sent[0]!.requestId,
      ok: false,
      error: 'This file is not open, cannot read the mindmap',
    })

    await expect(promise).rejects.toThrow('This file is not open, cannot read the mindmap')
  })

  it('ignores responses for unknown requestIds (already timed out / answered)', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request<string>(() => buildMindmapReadRequest('file-a'))
    requester.respond({ requestId: 'unknown', ok: true, summary: 'x' })
    // An unknown requestId is a no-op: the pending request is still waiting.
    expect(requester.pendingCount).toBe(1)

    requester.respond({ requestId: sent[0]!.requestId, ok: true, summary: 'Tree' })
    await expect(promise).resolves.toBe('Tree')
  })

  it('correlates concurrent requests so multi-file generation does not cross wires', async () => {
    const { window, sent } = fakeWindow()
    const requester = createMindmapReadRequester(() => window as unknown as BrowserWindow)

    const promiseA = requester.request<string>(() => buildMindmapReadRequest('file-a'))
    const promiseB = requester.request<string>(() => buildMindmapReadRequest('file-b'))
    expect(sent.map((r) => r.fileUuid)).toEqual(['file-a', 'file-b'])

    requester.respond({ requestId: sent[1]!.requestId, ok: true, summary: 'Tree B' })
    requester.respond({ requestId: sent[0]!.requestId, ok: true, summary: 'Tree A' })

    await expect(promiseA).resolves.toBe('Tree A')
    await expect(promiseB).resolves.toBe('Tree B')
  })

  it('times out after ~3s with a clear error', async () => {
    const { window } = fakeWindow()
    const requester = createMindmapReadRequester(() => window as unknown as BrowserWindow)

    const promise = requester.request<string>(() => buildMindmapReadRequest('file-a'))
    // Attach the assertion handler first to avoid an unhandled rejection when the timer fires.
    const assertion = expect(promise).rejects.toThrow(
      'Read mindmap timed out (no response from the renderer within 3s)',
    )
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    expect(requester.pendingCount).toBe(0)
  })

  it('rejects immediately when the window is unavailable (file closed / app window gone)', async () => {
    const requester = createMindmapReadRequester(() => null)

    await expect(
      requester.request<string>(() => buildMindmapReadRequest('file-a')),
    ).rejects.toThrow('Editor is unavailable (the window is closed); cannot read mindmap')
  })
})
