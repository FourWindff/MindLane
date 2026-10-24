import { describe, expect, it } from 'vitest'
import type { ChatStreamEvent, StreamStepPayload } from './ipc.js'
import { isStreamStep } from './ipc.js'

/**
 * Compile-time guards: each event contract declares a narrowing function, so this
 * file fails to compile when a discriminated union is missing a field or has the wrong shape.
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

describe('ChatStreamEvent contract: step payload is { step, callId?, completed?, total? }', () => {
  const sample: ChatStreamEvent = {
    streamId: 'stream-1',
    sessionId: 'session-1',
    type: 'step',
    payload: { step: 'extracting', callId: 'call-mm', completed: 3, total: 8 },
  }

  it('narrows to a payload exposing step/callId/completed/total', () => {
    expect(guardStep(sample)).toBe(true)
    if (guardStep(sample)) {
      const payload: StreamStepPayload = sample.payload
      expect(isStreamStep(payload.step)).toBe(true)
      expect(payload.step).toBe('extracting')
      expect(payload.callId).toBe('call-mm')
      expect(payload.completed).toBe(3)
      expect(payload.total).toBe(8)
    }
  })

  it('allows omitting the call id and both counts (bare step event)', () => {
    const bare: ChatStreamEvent = {
      streamId: 's',
      sessionId: 's',
      type: 'step',
      payload: { step: 'generating-map' },
    }
    expect(guardStep(bare)).toBe(true)
  })
})
