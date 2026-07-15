import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamManager, type StreamRuntime } from '../streamManager.js'
import { ToolRegistry } from '../tools/registry.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

const defaultRequestFields = {
  workspaceUuid: 'workspace-a',
  context: { fileUuid: 'file-a' },
}

function createHarness() {
  const persisted = new Map<string, BaseMessage[]>()
  const sessionManager = {
    isReady: vi.fn(() => true),
    runInWorkspace: vi.fn((_workspaceUuid: string, action: () => unknown) => action()),
    loadSessionBaseMessages: vi.fn(async (sessionId: string) => [
      ...(persisted.get(sessionId) ?? []),
    ]),
    loadSessionMessages: vi.fn(async () => []),
    saveMessage: vi.fn(async (sessionId: string, message: BaseMessage) => {
      persisted.set(sessionId, [...(persisted.get(sessionId) ?? []), message])
    }),
    saveMessages: vi.fn(async (sessionId: string, messages: BaseMessage[]) => {
      persisted.set(sessionId, [...(persisted.get(sessionId) ?? []), ...messages])
    }),
  }
  const extractAndPersist = vi.fn(async () => undefined)
  const events: Array<{
    streamId: string
    sessionId: string
    type: string
    payload: unknown
  }> = []
  let runtimeFactory: (request: {
    sessionId: string
  }) => StreamRuntime | Promise<StreamRuntime> = () => createRuntime()
  const manager = new StreamManager({
    aiService: {
      sessionManager,
      memoryExtractor: { extractAndPersist },
      checkpointer: { getMessages: vi.fn(async () => []) },
    } as never,
    eventSink: (event) => events.push(event),
    createRuntime: (request) => runtimeFactory(request),
  })

  return {
    manager,
    sessionManager,
    persisted,
    events,
    extractAndPersist,
    setRuntimeFactory(factory: typeof runtimeFactory) {
      runtimeFactory = factory
    },
  }
}

function createRuntime(options?: {
  gate?: Promise<void>
  gatesBySession?: Record<string, Promise<void>>
  token?: string
  tokensBySession?: Record<string, string>
  fail?: Error
  capturedToolNames?: string[][]
  omitAssistantState?: boolean
  includeToolState?: boolean
}): StreamRuntime {
  const registry = new ToolRegistry()
  registry.registerTool({ name: 'initial-tool' } as never)
  const graph = {
    streamEvents: vi.fn().mockImplementation(async function* (
      _input: unknown,
      config: { configurable?: { thread_id?: string; tool_names?: string[] } },
    ) {
      const sessionId = config.configurable?.thread_id ?? ''
      options?.capturedToolNames?.push(config.configurable?.tool_names ?? [])
      if (options?.fail) throw options.fail
      yield {
        event: 'on_chat_model_stream',
        metadata: { langgraph_node: 'supervisor' },
        data: {
          chunk: { content: options?.tokensBySession?.[sessionId] ?? options?.token ?? 'hello' },
        },
      }
      await options?.gatesBySession?.[sessionId]
      await options?.gate
    }),
    getState: vi.fn().mockResolvedValue({
      values: {
        messages: [
          new HumanMessage('question'),
          ...(options?.omitAssistantState ? [] : [new AIMessage(options?.token ?? 'hello')]),
          ...(options?.includeToolState
            ? [new ToolMessage({ content: 'tool result', tool_call_id: 'call-1', name: 'tool' })]
            : []),
        ],
        response: options?.token ?? 'hello',
        memoryRoute: [],
        imageUrls: [],
      },
    }),
  }

  return {
    graph,
    toolRegistry: registry,
    buildResponse: (_state, content) => ({ content: content ?? '' }),
    provider: {},
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition not reached')
}

describe('StreamManager + Runner', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a stream ID and emits identified events', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() => createRuntime())

    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a', filePath: '/a.mindlane' },
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(streamId).toMatch(/^stream_/)
    expect(events).toEqual(
      expect.arrayContaining([
        { streamId, sessionId: 'session-a', type: 'token', payload: 'hello' },
        expect.objectContaining({ streamId, sessionId: 'session-a', type: 'end' }),
      ]),
    )
  })

  it('runs multiple streams concurrently with distinct IDs', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    const gateA = deferred<void>()
    const gateB = deferred<void>()

    setRuntimeFactory(() =>
      createRuntime({
        gatesBySession: { 'session-a': gateA.promise, 'session-b': gateB.promise },
        tokensBySession: { 'session-a': 'A', 'session-b': 'B' },
      }),
    )
    const streamA = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a', filePath: '/a.mindlane' },
    })
    const streamB = manager.startStream({
      sessionId: 'session-b',
      message: 'question',
      workspaceUuid: 'workspace-b',
      context: { fileUuid: 'file-b' },
    })

    await waitUntil(() => manager.getActiveStreamCount() === 2)
    expect(streamA).not.toBe(streamB)
    gateA.resolve()
    gateB.resolve()
    await waitUntil(() => manager.getActiveStreamCount() === 0)
    expect(events.filter((event) => event.type === 'end').map((event) => event.streamId)).toEqual(
      expect.arrayContaining([streamA, streamB]),
    )
  })

  it('stops only the target stream', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    const gateA = deferred<void>()
    const gateB = deferred<void>()
    setRuntimeFactory(() =>
      createRuntime({
        gatesBySession: { 'session-a': gateA.promise, 'session-b': gateB.promise },
        tokensBySession: { 'session-a': 'partial-A', 'session-b': 'partial-B' },
      }),
    )
    const streamA = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a', filePath: '/a.mindlane' },
    })
    const streamB = manager.startStream({
      sessionId: 'session-b',
      message: 'question',
      workspaceUuid: 'workspace-b',
      context: { fileUuid: 'file-b' },
    })
    await waitUntil(() => events.filter((event) => event.type === 'token').length === 2)

    expect(manager.stopStream(streamA)).toBe(true)
    gateA.resolve()
    await waitUntil(() =>
      events.some((event) => event.streamId === streamA && event.type === 'end'),
    )
    expect(manager.getActiveStreamCount()).toBe(1)

    gateB.resolve()
    await waitUntil(() => manager.getActiveStreamCount() === 0)
    expect(events.some((event) => event.streamId === streamB && event.type === 'end')).toBe(true)
  })

  it('persists partial assistant content when stopped', async () => {
    const { manager, events, persisted, extractAndPersist, setRuntimeFactory } = createHarness()
    const gate = deferred<void>()
    setRuntimeFactory(() =>
      createRuntime({
        gate: gate.promise,
        token: 'partial answer',
        omitAssistantState: true,
        includeToolState: true,
      }),
    )
    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a', filePath: '/a.mindlane' },
    })
    await waitUntil(() => events.some((event) => event.type === 'token'))

    manager.stopStream(streamId)
    gate.resolve()
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(
      persisted.get('session-a')?.some((message) => message.content === 'partial answer'),
    ).toBe(true)
    expect(persisted.get('session-a')?.some((message) => message.type === 'tool')).toBe(true)
    expect(events.some((event) => event.streamId === streamId && event.type === 'end')).toBe(true)
    await waitUntil(() => extractAndPersist.mock.calls.length === 1)
  })

  it('emits an error when runner startup fails', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() => {
      throw new Error('startup failed')
    })
    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a' },
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'error',
      payload: 'startup failed',
    })
  })

  it('snapshots tools before later registry changes', async () => {
    const { manager, setRuntimeFactory } = createHarness()
    const gate = deferred<void>()
    const capturedToolNames: string[][] = []
    const runtime = createRuntime({ gate: gate.promise, capturedToolNames })

    setRuntimeFactory(() => runtime)
    manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      ...defaultRequestFields,
      context: { fileUuid: 'file-a' },
    })
    runtime.toolRegistry.registerTool({ name: 'late-tool' } as never)
    await waitUntil(() => capturedToolNames.length === 1)
    gate.resolve()
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(capturedToolNames).toEqual([['initial-tool']])
  })

  it('shares the compiled runtime across concurrent streams', async () => {
    const { manager, setRuntimeFactory } = createHarness()
    const createRuntimeSpy = vi.fn(() => createRuntime())
    setRuntimeFactory(createRuntimeSpy)

    manager.startStream({ sessionId: 'session-a', message: 'question', ...defaultRequestFields })
    manager.startStream({ sessionId: 'session-b', message: 'question', ...defaultRequestFields })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(createRuntimeSpy).toHaveBeenCalledTimes(1)
    manager.invalidateRuntime()
    manager.startStream({ sessionId: 'session-c', message: 'question', ...defaultRequestFields })
    await waitUntil(() => manager.getActiveStreamCount() === 0)
    expect(createRuntimeSpy).toHaveBeenCalledTimes(2)
  })
})
