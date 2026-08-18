import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamManager, type StreamRuntime } from '../streamManager.js'
import type { SessionManager } from '../context/sessionManager.js'
import { ToolRegistry } from '../tools/registry.js'
import { logger, type LogSink } from '../../shared/logger.js'

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
    sessionManager: sessionManager as unknown as SessionManager,
    eventSink: (event) => events.push(event),
    createRuntime: (request) => runtimeFactory(request),
  })

  return {
    manager,
    sessionManager,
    persisted,
    events,
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
  capturedInputs?: Array<{ messages: BaseMessage[] }>
  omitAssistantState?: boolean
  includeToolState?: boolean
  progress?: { step: string; completed?: number; total?: number }
  toolEvents?: Array<Record<string, unknown>>
  messageChunks?: Array<{
    id: string
    content: string
    /** supervisor AI 消息携带的工具调用（子图补发 tool-start 用） */
    toolCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>
    /** tool 消息 chunk（子图 ToolMessage 补发 tool-end 用） */
    type?: 'tool'
    name?: string
    toolCallId?: string
    /** 消息所属节点（默认 supervisor；tool 消息默认 subgraphResult） */
    node?: string
  }>
}): StreamRuntime {
  const registry = new ToolRegistry()
  registry.registerTool({ name: 'initial-tool' } as never)
  const graph = {
    stream: vi.fn().mockImplementation(async function* (
      input: { messages: BaseMessage[] },
      config: { configurable?: { thread_id?: string; tool_names?: string[] } },
    ) {
      options?.capturedInputs?.push({ messages: input.messages })
      const sessionId = config.configurable?.thread_id ?? ''
      options?.capturedToolNames?.push(config.configurable?.tool_names ?? [])
      if (options?.fail) throw options.fail
      if (options?.progress) {
        yield ['custom', { type: 'mindmap-progress', ...options.progress }]
      }
      for (const toolEvent of options?.toolEvents ?? []) {
        yield ['tools', toolEvent]
      }
      const messageChunks = options?.messageChunks ?? [
        {
          id: `message-${sessionId}`,
          content: options?.tokensBySession?.[sessionId] ?? options?.token ?? 'hello',
        },
      ]
      for (const chunk of messageChunks) {
        if (chunk.type === 'tool') {
          yield [
            'messages',
            [
              new ToolMessage({
                content: chunk.content,
                tool_call_id: chunk.toolCallId ?? '',
                name: chunk.name,
              }),
              { langgraph_node: chunk.node ?? 'subgraphResult' },
            ],
          ]
        } else {
          yield [
            'messages',
            [
              new AIMessageChunk({
                id: chunk.id,
                content: chunk.content,
                ...(chunk.toolCalls
                  ? {
                      tool_call_chunks: chunk.toolCalls.map((tc, index) => ({
                        id: tc.id ?? '',
                        name: tc.name ?? '',
                        args: JSON.stringify(tc.args ?? {}),
                        index,
                      })),
                    }
                  : {}),
              }),
              { langgraph_node: chunk.node ?? 'supervisor' },
            ],
          ]
        }
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

  it('persists the user message with a trailing EDITOR_STATE turn-state block', async () => {
    const { manager, persisted, setRuntimeFactory } = createHarness()
    const capturedInputs: Array<{ messages: BaseMessage[] }> = []
    setRuntimeFactory(() => createRuntime({ capturedInputs }))

    manager.startStream({
      sessionId: 'session-a',
      message: '请整理我的导图',
      workspaceUuid: 'workspace-a',
      context: {
        fileUuid: 'file-a',
        filePath: '/a.mindlane',
        fileTitle: 'A 导图',
        selectedNodes: [{ id: 'n1', type: 'text', label: '选中节点' }],
      },
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    // 持久化格式：`问题\n<EDITOR_STATE>…</EDITOR_STATE>`
    const userMessage = persisted.get('session-a')?.find((m) => m.getType() === 'human')
    expect(userMessage).toBeDefined()
    const content = String(userMessage!.content)
    expect(content.startsWith('请整理我的导图\n<EDITOR_STATE')).toBe(true)
    expect(content.endsWith('</EDITOR_STATE>')).toBe(true)
    expect(content).toContain('file_uuid="file-a"')
    expect(content).toContain('<SELECTED_NODES count="1">')
    expect(content).toContain('content="选中节点"')
    // 导图树不进轮次状态（无 <MINDMAP 外壳）。
    expect(content).not.toContain('<MINDMAP')

    // 重载会话重建模型输入：该块仍在（模型输入不过滤）。
    const modelInput = capturedInputs[0]?.messages
    expect(modelInput).toBeDefined()
    expect(modelInput!.some((m) => String(m.content).endsWith('</EDITOR_STATE>'))).toBe(true)
  })

  it('persists an explicit empty selection as count="0"', async () => {
    const { manager, persisted, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() => createRuntime())

    manager.startStream({
      sessionId: 'session-empty',
      message: '没有选中任何节点',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a', filePath: '/a.mindlane', fileTitle: 'A' },
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    const userMessage = persisted.get('session-empty')?.find((m) => m.getType() === 'human')
    expect(String(userMessage!.content)).toContain('<SELECTED_NODES count="0">')
  })

  it('emits mindmap pipeline progress', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() => createRuntime({ progress: { step: 'extracting' } }))

    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      ...defaultRequestFields,
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'step',
      payload: { step: 'extracting' },
    })
  })

  it('passes completed/total counts through step events (counts are not dropped)', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() =>
      createRuntime({ progress: { step: 'extracting', completed: 3, total: 8 } }),
    )

    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      ...defaultRequestFields,
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'step',
      payload: { step: 'extracting', completed: 3, total: 8 },
    })
  })

  it('emits tool-start with the tool call id and tool-end with id + status from the result', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() =>
      createRuntime({
        toolEvents: [
          {
            event: 'on_tool_start',
            toolCallId: 'call-1',
            name: 'insertXmlFragment',
            input: { xml: '<node/>' },
          },
          {
            event: 'on_tool_end',
            toolCallId: 'call-1',
            name: 'insertXmlFragment',
            output: JSON.stringify({ ok: true, action: 'insertXmlFragment', data: {} }),
          },
          {
            event: 'on_tool_start',
            toolCallId: 'call-2',
            name: 'updateMindmapNode',
            input: {},
          },
          {
            event: 'on_tool_end',
            toolCallId: 'call-2',
            name: 'updateMindmapNode',
            output: JSON.stringify({ ok: false, error: '[block_not_found] …' }),
          },
        ],
      }),
    )

    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      ...defaultRequestFields,
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'tool-start',
      payload: { id: 'call-1', name: 'insertXmlFragment', input: { xml: '<node/>' } },
    })
    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'tool-end',
      payload: {
        id: 'call-1',
        name: 'insertXmlFragment',
        status: 'success',
        output: JSON.stringify({ ok: true, action: 'insertXmlFragment', data: {} }),
      },
    })
    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'tool-end',
      payload: expect.objectContaining({ id: 'call-2', status: 'error' }),
    })
  })

  it('emits a terminal tool-end with error status when a tool throws (on_tool_error)', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() =>
      createRuntime({
        toolEvents: [
          {
            event: 'on_tool_start',
            toolCallId: 'call-err',
            name: 'insertXmlFragment',
            input: { xml: '<node/>' },
          },
          {
            event: 'on_tool_error',
            toolCallId: 'call-err',
            name: 'insertXmlFragment',
            error: new Error('boom'),
          },
        ],
      }),
    )

    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      ...defaultRequestFields,
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'tool-end',
      payload: { id: 'call-err', name: 'insertXmlFragment', status: 'error', output: 'boom' },
    })
  })

  it('logs loudly when a tool event lacks toolCallId but still emits for name matching', async () => {
    const errors: string[] = []
    const sink: LogSink = { write: (line) => errors.push(line) }
    logger.setSink(sink)
    try {
      const { manager, events, setRuntimeFactory } = createHarness()
      setRuntimeFactory(() =>
        createRuntime({
          toolEvents: [
            {
              event: 'on_tool_start',
              name: 'insertXmlFragment',
              input: { xml: '<node/>' },
            },
            {
              event: 'on_tool_end',
              name: 'insertXmlFragment',
              output: '{"ok":true}',
            },
          ],
        }),
      )

      const streamId = manager.startStream({
        sessionId: 'session-a',
        message: 'question',
        ...defaultRequestFields,
      })
      await waitUntil(() => manager.getActiveStreamCount() === 0)

      expect(errors.some((line) => line.includes('[ERROR]'))).toBe(true)
      expect(events).toContainEqual({
        streamId,
        sessionId: 'session-a',
        type: 'tool-start',
        payload: { id: '', name: 'insertXmlFragment', input: { xml: '<node/>' } },
      })
      expect(events).toContainEqual({
        streamId,
        sessionId: 'session-a',
        type: 'tool-end',
        payload: { id: '', name: 'insertXmlFragment', status: 'success', output: '{"ok":true}' },
      })
    } finally {
      logger.setSink(null)
    }
  })

  it('re-emits subgraph tool-start/tool-end from messages-mode chunks', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    const subgraphResult = JSON.stringify({
      ok: true,
      title: '测试导图',
      xmlFragment: 'root:',
      documentRef: null,
    })
    setRuntimeFactory(() =>
      createRuntime({
        messageChunks: [
          {
            id: 'm1',
            content: '',
            toolCalls: [{ id: 'call-sub-1', name: 'generateMindmapFragment', args: { doc: 'x' } }],
          },
          {
            id: 'm1',
            content: subgraphResult,
            type: 'tool',
            name: 'generateMindmapFragment',
            toolCallId: 'call-sub-1',
          },
          { id: 'm2', content: '完成' },
        ],
      }),
    )

    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      ...defaultRequestFields,
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    // 子图虚拟调用不走 ToolNode：tool-start 由 supervisor 消息 chunk 补发（带 id），
    // tool-end 由子图 ToolMessage 到达补发（状态来自结果 ok 字段）。
    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'tool-start',
      payload: { id: 'call-sub-1', name: 'generateMindmapFragment', input: { doc: 'x' } },
    })
    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'tool-end',
      payload: {
        id: 'call-sub-1',
        name: 'generateMindmapFragment',
        status: 'success',
        output: subgraphResult,
      },
    })
  })

  it('re-emits palace subgraph tool-end as well, and error results derive status from the ok field', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    const palaceError = JSON.stringify({ ok: false, error: '生成失败' })
    setRuntimeFactory(() =>
      createRuntime({
        messageChunks: [
          {
            id: 'm1',
            content: '',
            toolCalls: [{ id: 'call-palace-1', name: 'generatePalace', args: {} }],
          },
          {
            id: 'm1',
            content: palaceError,
            type: 'tool',
            name: 'generatePalace',
            toolCallId: 'call-palace-1',
          },
          { id: 'm2', content: '完成' },
        ],
      }),
    )

    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      ...defaultRequestFields,
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'tool-start',
      payload: { id: 'call-palace-1', name: 'generatePalace', input: {} },
    })
    expect(events).toContainEqual({
      streamId,
      sessionId: 'session-a',
      type: 'tool-end',
      payload: {
        id: 'call-palace-1',
        name: 'generatePalace',
        status: 'error',
        output: palaceError,
      },
    })
  })

  it('re-emitted tool events coexist with the step stream without duplication', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() =>
      createRuntime({
        progress: { step: 'extracting', completed: 2, total: 5 },
        messageChunks: [
          {
            id: 'm1',
            content: '',
            toolCalls: [{ id: 'call-sub-1', name: 'generateMindmapFragment', args: {} }],
          },
          {
            id: 'm1',
            content: JSON.stringify({ ok: true, title: 'T', xmlFragment: 'x' }),
            type: 'tool',
            name: 'generateMindmapFragment',
            toolCallId: 'call-sub-1',
          },
          { id: 'm2', content: '完成' },
        ],
      }),
    )

    const streamId = manager.startStream({
      sessionId: 'session-a',
      message: 'question',
      ...defaultRequestFields,
    })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(events.filter((e) => e.type === 'step')).toEqual([
      {
        streamId,
        sessionId: 'session-a',
        type: 'step',
        payload: { step: 'extracting', completed: 2, total: 5 },
      },
    ])
    expect(events.filter((e) => e.type === 'tool-start')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'tool-end')).toHaveLength(1)
  })

  it('emits no subgraph tool events when the stream has no subgraph calls', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() =>
      createRuntime({
        toolEvents: [
          {
            event: 'on_tool_start',
            toolCallId: 'call-1',
            name: 'insertXmlFragment',
            input: {},
          },
          {
            event: 'on_tool_end',
            toolCallId: 'call-1',
            name: 'insertXmlFragment',
            output: JSON.stringify({ ok: true, action: 'insertXmlFragment', data: {} }),
          },
        ],
      }),
    )

    manager.startStream({ sessionId: 'session-a', message: 'question', ...defaultRequestFields })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    // 回归：无子图调用时，不产生任何子图 tool-start/tool-end 补发。
    const subgraphEvents = events.filter(
      (e) =>
        (e.type === 'tool-start' || e.type === 'tool-end') &&
        (e.payload as { name?: string }).name?.includes('generate'),
    )
    expect(subgraphEvents).toEqual([])
  })

  it('starts a new assistant segment when the streamed message ID changes', async () => {
    const { manager, events, setRuntimeFactory } = createHarness()
    setRuntimeFactory(() =>
      createRuntime({
        messageChunks: [
          { id: 'message-1', content: 'first' },
          { id: 'message-2', content: 'second' },
        ],
      }),
    )

    manager.startStream({ sessionId: 'session-a', message: 'question', ...defaultRequestFields })
    await waitUntil(() => manager.getActiveStreamCount() === 0)

    expect(events.map((event) => event.type)).toEqual(['token', 'message-start', 'token', 'end'])
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
    const { manager, events, persisted, setRuntimeFactory } = createHarness()
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
