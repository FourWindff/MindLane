import { describe, expect, it } from 'vitest'
import type {
  ChatStreamEvent,
  MindmapWriteRequest,
  MindmapWriteResponse,
  StreamStepPayload,
} from '../ipc.js'
import { isStreamStep } from '../ipc.js'

/**
 * 类型看守（compile-time guards）：每个事件契约声明一个收窄函数，
 * 判别联合缺字段/形状不符时本文件编译失败。
 */

function guardToolStart(
  event: ChatStreamEvent,
): event is Extract<ChatStreamEvent, { type: 'tool-start' }> {
  return event.type === 'tool-start'
}

function guardToolEnd(
  event: ChatStreamEvent,
): event is Extract<ChatStreamEvent, { type: 'tool-end' }> {
  return event.type === 'tool-end'
}

function guardStep(event: ChatStreamEvent): event is Extract<ChatStreamEvent, { type: 'step' }> {
  return event.type === 'step'
}

describe('ChatStreamEvent contract: tool-start carries the tool call id', () => {
  const sample: ChatStreamEvent = {
    streamId: 'stream-1',
    sessionId: 'session-1',
    type: 'tool-start',
    payload: { id: 'call-1', name: 'insertXmlFragment', input: { xml: '<node/>' } },
  }

  it('narrows to a payload exposing id/name/input', () => {
    expect(guardToolStart(sample)).toBe(true)
    if (guardToolStart(sample)) {
      const id: string = sample.payload.id
      const name: string = sample.payload.name
      const input: Record<string, unknown> = sample.payload.input
      expect(id).toBe('call-1')
      expect(name).toBe('insertXmlFragment')
      expect(input).toEqual({ xml: '<node/>' })
    }
  })
})

describe('ChatStreamEvent contract: tool-end carries id + status', () => {
  const sample: ChatStreamEvent = {
    streamId: 'stream-1',
    sessionId: 'session-1',
    type: 'tool-end',
    payload: { id: 'call-1', name: 'insertXmlFragment', status: 'error', output: 'oops' },
  }

  it('narrows to a payload exposing id/name/status/output', () => {
    expect(guardToolEnd(sample)).toBe(true)
    if (guardToolEnd(sample)) {
      const id: string = sample.payload.id
      const status: 'success' | 'error' = sample.payload.status
      const output: string = sample.payload.output
      expect(id).toBe('call-1')
      expect(status).toBe('error')
      expect(output).toBe('oops')
    }
  })

  it('accepts success as a valid status', () => {
    const ok: ChatStreamEvent = {
      streamId: 's',
      sessionId: 's',
      type: 'tool-end',
      payload: { id: 'call-2', name: 'x', status: 'success', output: '{}' },
    }
    expect(guardToolEnd(ok)).toBe(true)
  })
})

describe('ChatStreamEvent contract: step payload is { step, completed?, total? }', () => {
  const sample: ChatStreamEvent = {
    streamId: 'stream-1',
    sessionId: 'session-1',
    type: 'step',
    payload: { step: 'extracting', completed: 3, total: 8 },
  }

  it('narrows to a payload exposing step/completed/total', () => {
    expect(guardStep(sample)).toBe(true)
    if (guardStep(sample)) {
      const payload: StreamStepPayload = sample.payload
      expect(isStreamStep(payload.step)).toBe(true)
      expect(payload.step).toBe('extracting')
      expect(payload.completed).toBe(3)
      expect(payload.total).toBe(8)
    }
  })

  it('allows omitting both counts (bare step event)', () => {
    const bare: ChatStreamEvent = {
      streamId: 's',
      sessionId: 's',
      type: 'step',
      payload: { step: 'generating-map' },
    }
    expect(guardStep(bare)).toBe(true)
  })
})

describe('MindmapWrite request/response payload shapes', () => {
  it('declares the request shape: requestId + fileUuid + action + args', () => {
    const request: MindmapWriteRequest = {
      requestId: 'req-1',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: { xml: '<node/>', parentId: 'root' },
    }
    expect(request.requestId).toBe('req-1')
    expect(request.fileUuid).toBe('file-a')
    expect(request.action).toBe('insertXmlFragment')
    expect(request.args).toEqual({ xml: '<node/>', parentId: 'root' })
  })

  it('declares the ok response shape: {ok, action, data}', () => {
    const response: MindmapWriteResponse = {
      requestId: 'req-1',
      ok: true,
      action: 'insertXmlFragment',
      data: { nodeCount: 1 },
    }
    expect(response.requestId).toBe('req-1')
    expect(response.ok).toBe(true)
    expect(response.action).toBe('insertXmlFragment')
    expect(response.data).toEqual({ nodeCount: 1 })
  })

  it('declares the error response shape: {ok: false, error}', () => {
    const response: MindmapWriteResponse = {
      requestId: 'req-1',
      ok: false,
      error: '[block_not_found] …',
    }
    expect(response.ok).toBe(false)
    expect(response.error).toContain('block_not_found')
  })

  it('correlates request and response by requestId', () => {
    const request: MindmapWriteRequest = {
      requestId: 'req-1',
      fileUuid: 'file-a',
      action: 'a',
      args: {},
    }
    const ok: MindmapWriteResponse = { requestId: 'req-1', ok: true, action: 'a', data: null }
    const error: MindmapWriteResponse = { requestId: 'req-1', ok: false, error: 'e' }
    expect(ok.requestId).toBe(request.requestId)
    expect(error.requestId).toBe(request.requestId)
  })
})
