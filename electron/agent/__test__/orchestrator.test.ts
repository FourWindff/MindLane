import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentOrchestrator } from '../orchestrator.js'
import { AiService } from '../service.js'
import { ProviderCapability, type LLMProvider } from '../providers/index.js'
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionManager } from '../context/sessionManager.js'

// ─── Mock 工厂 ───────────────────────────────────────────────

function createMockProvider(
  capabilities: Set<ProviderCapability> = new Set([ProviderCapability.Chat]),
): LLMProvider {
  const mockModel = {
    invoke: vi.fn(),
    bindTools: vi.fn().mockReturnValue({ invoke: vi.fn() }),
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: vi.fn() }),
  }

  return {
    reasoningModel: mockModel,
    visionModel: undefined,
    capabilities,
    chatModels: [],
  } as unknown as LLMProvider
}

function createMockSessionManager(
  history: BaseMessage[] = [],
  loadedSessionBaseMessages: BaseMessage[] = [],
) {
  const saved: BaseMessage[] = []
  return {
    isReady: vi.fn(() => true),
    saveMessage: vi.fn(async (_: string, msg: BaseMessage) => {
      saved.push(msg)
    }),
    saveMessages: vi.fn(async (_: string, msgs: BaseMessage[]) => {
      saved.push(...msgs)
    }),
    loadSessionMessages: vi.fn(async () => []),
    loadSessionBaseMessages: vi.fn(async () =>
      loadedSessionBaseMessages.length > 0 ? [...loadedSessionBaseMessages] : [...history],
    ),
    saved,
  }
}

function createMockAiService(
  checkpointer?: unknown,
  sessionManager?: ReturnType<typeof createMockSessionManager>,
): AiService {
  return {
    checkpointer: {
      getAdapter: vi.fn().mockReturnValue(checkpointer),
      get: vi.fn().mockReturnValue(null),
    },
    sessionManager,
  } as unknown as AiService
}

// ─── 测试 ────────────────────────────────────────────────────

describe('AgentOrchestrator 编译缓存', () => {
  let provider: LLMProvider
  let aiService: AiService
  let orchestrator: AgentOrchestrator

  beforeEach(() => {
    provider = createMockProvider()
    aiService = createMockAiService()
    orchestrator = new AgentOrchestrator(provider, aiService)
  })

  it('getCompiledMainGraph() 多次调用返回同一实例', () => {
    const getCompiledMainGraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'getCompiledMainGraph'
    ].bind(orchestrator)
    expect(getCompiledMainGraph()).toBe(getCompiledMainGraph())
  })

  it('getCompiledMindmapSubgraph() 多次调用返回同一实例', () => {
    const getCompiledMindmapSubgraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'getCompiledMindmapSubgraph'
    ].bind(orchestrator)
    expect(getCompiledMindmapSubgraph()).toBe(getCompiledMindmapSubgraph())
  })

  it('getCompiledPalaceSubgraph() 多次调用返回同一实例', () => {
    provider = createMockProvider(
      new Set([ProviderCapability.Chat, ProviderCapability.ImageGen, ProviderCapability.Vision]),
    )
    orchestrator = new AgentOrchestrator(provider, aiService)
    const getCompiledPalaceSubgraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'getCompiledPalaceSubgraph'
    ].bind(orchestrator)
    expect(getCompiledPalaceSubgraph()).toBe(getCompiledPalaceSubgraph())
  })
})

describe('AgentOrchestrator checkpointer 注入', () => {
  it('getCompiledMainGraph() 优先使用 aiService.checkpointer.getAdapter() 返回的 checkpointer', () => {
    const mockCheckpointer = { put: vi.fn(), get: vi.fn() }
    const provider = createMockProvider()
    const aiService = createMockAiService(mockCheckpointer)
    const orchestrator = new AgentOrchestrator(provider, aiService)

    const getCompiledMainGraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'getCompiledMainGraph'
    ].bind(orchestrator)

    getCompiledMainGraph()

    expect(aiService.checkpointer.getAdapter).toHaveBeenCalled()
  })

  it('getCompiledMainGraph() 在 checkpointer 为 undefined 时不报错', () => {
    const provider = createMockProvider()
    const aiService = createMockAiService(undefined)
    const orchestrator = new AgentOrchestrator(provider, aiService)

    const getCompiledMainGraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'getCompiledMainGraph'
    ].bind(orchestrator)

    expect(() => getCompiledMainGraph()).not.toThrow()

    const instance = getCompiledMainGraph()
    expect(instance).toBeDefined()
  })
})

describe('AgentOrchestrator buildGraph 结构', () => {
  it('无论 hasPalace 如何，graph 节点结构完全一致', () => {
    const providerWithPalace = createMockProvider(
      new Set([ProviderCapability.Chat, ProviderCapability.ImageGen, ProviderCapability.Vision]),
    )
    const providerWithoutPalace = createMockProvider(new Set([ProviderCapability.Chat]))

    const orchestratorWith = new AgentOrchestrator(providerWithPalace, createMockAiService())
    const orchestratorWithout = new AgentOrchestrator(providerWithoutPalace, createMockAiService())

    const buildGraphWith = (
      orchestratorWith as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestratorWith)
    const buildGraphWithout = (
      orchestratorWithout as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestratorWithout)

    const graphWith = buildGraphWith()
    const graphWithout = buildGraphWithout()

    expect(Object.keys(graphWith.nodes)).toContain('palaceSubgraph')
    expect(Object.keys(graphWith.nodes)).toContain('mindmapToolResult')
    expect(Object.keys(graphWith.nodes)).toContain('palaceToolResult')
    expect(Object.keys(graphWithout.nodes)).toContain('palaceSubgraph')
    expect(Object.keys(graphWith.nodes)).toEqual(Object.keys(graphWithout.nodes))
  })
})

describe('AgentOrchestrator stream() 消息输入', () => {
  it('始终只传入当前新消息，由 LangGraph checkpointer 管理历史', async () => {
    const provider = createMockProvider()
    const aiService = createMockAiService()
    const orchestrator = new AgentOrchestrator(provider, aiService)

    const capturedInputs: Array<{ messages: BaseMessage[] }> = []
    const mockGraph = {
      streamEvents: vi.fn().mockImplementation(async function* (input: {
        messages: BaseMessage[]
      }) {
        capturedInputs.push(input)
        yield { event: 'on_chat_model_stream', data: { chunk: { content: 'ok' } } }
      }),
      getState: vi.fn().mockResolvedValue({
        values: {
          messages: [],
          pendingSubgraph: null,
          response: 'ok',
          memoryRoute: [],
          imageUrls: [],
        },
      }),
    }

    ;(orchestrator as unknown as { compiledMainGraph: typeof mockGraph }).compiledMainGraph =
      mockGraph

    await orchestrator.stream(
      { threadId: 'test-thread', message: '扩展子主题C', context: { workspacePath: '/test' } },
      {
        onToken: vi.fn(),
        onToolStart: vi.fn(),
        onToolEnd: vi.fn(),
        onEnd: vi.fn(),
        onError: vi.fn(),
      },
    )

    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0].messages).toHaveLength(1)
    expect(capturedInputs[0].messages[0]).toBeInstanceOf(HumanMessage)
    expect((capturedInputs[0].messages[0] as HumanMessage).content).toBe('扩展子主题C')
  })

  it('流式转发数组格式 chunk 中的文本内容', async () => {
    const provider = createMockProvider()
    const aiService = createMockAiService()
    const orchestrator = new AgentOrchestrator(provider, aiService)
    const onToken = vi.fn()
    const onEnd = vi.fn()

    const mockGraph = {
      streamEvents: vi.fn().mockImplementation(async function* () {
        yield {
          event: 'on_chat_model_stream',
          metadata: { langgraph_node: 'supervisor' },
          data: {
            chunk: {
              content: [
                { type: 'text', text: '我来生成思维导图。' },
                { type: 'tool_use', id: 'tool-1', name: 'generateMindmapFragment', input: '' },
              ],
            },
          },
        }
      }),
      getState: vi.fn().mockResolvedValue({
        values: {
          messages: [],
          pendingSubgraph: null,
          response: '我来生成思维导图。',
          memoryRoute: [],
          imageUrls: [],
        },
      }),
    }

    ;(orchestrator as unknown as { compiledMainGraph: typeof mockGraph }).compiledMainGraph =
      mockGraph

    await orchestrator.stream(
      { threadId: 'test-thread', message: '生成思维导图' },
      { onToken, onToolStart: vi.fn(), onToolEnd: vi.fn(), onEnd, onError: vi.fn() },
    )

    expect(onToken).toHaveBeenCalledWith('我来生成思维导图。')
    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '我来生成思维导图。',
      }),
    )
  })
})

describe('AgentOrchestrator contextCompact node', () => {
  it('graph includes contextCompact node', () => {
    const provider = createMockProvider()
    const orchestrator = new AgentOrchestrator(provider, createMockAiService())

    const buildGraph = (
      orchestrator as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestrator)
    const graph = buildGraph()

    expect(Object.keys(graph.nodes)).toContain('contextCompact')
  })

  it('START edge points to contextCompact, not supervisor', () => {
    const provider = createMockProvider()
    const orchestrator = new AgentOrchestrator(provider, createMockAiService())

    const buildGraph = (
      orchestrator as unknown as Record<string, () => { edges: Array<[string, string]> }>
    )['buildGraph'].bind(orchestrator)
    const graph = buildGraph()

    let startTarget = null
    for (const edge of graph.edges) {
      if (edge[0] === '__start__') {
        startTarget = edge[1]
        break
      }
    }
    expect(startTarget).toBe('contextCompact')
  })
})

describe('AgentOrchestrator long history handling', () => {
  it('stream passes current message through contextCompact to graph', async () => {
    const provider = createMockProvider()
    const aiService = createMockAiService()
    const orchestrator = new AgentOrchestrator(provider, aiService)

    const capturedInputs: Array<{ messages: BaseMessage[] }> = []
    const mockGraph = {
      streamEvents: vi.fn().mockImplementation(async function* (input: {
        messages: BaseMessage[]
      }) {
        capturedInputs.push(input)
        yield { event: 'on_chat_model_stream', data: { chunk: { content: 'ok' } } }
      }),
      getState: vi.fn().mockResolvedValue({
        values: {
          messages: [],
          pendingSubgraph: null,
          response: 'ok',
          memoryRoute: [],
          imageUrls: [],
        },
      }),
    }

    ;(orchestrator as unknown as { compiledMainGraph: typeof mockGraph }).compiledMainGraph =
      mockGraph

    await orchestrator.stream(
      { threadId: 'test-thread', message: 'hello' },
      {
        onToken: vi.fn(),
        onToolStart: vi.fn(),
        onToolEnd: vi.fn(),
        onEnd: vi.fn(),
        onError: vi.fn(),
      },
    )

    // The initial state still only has the current message; compact happens inside the graph
    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0].messages).toHaveLength(1)
    expect(capturedInputs[0].messages[0]).toBeInstanceOf(HumanMessage)
  })
})

describe('AgentOrchestrator extractToolCalls', () => {
  let extractToolCalls: (msgs: BaseMessage[]) => Array<{ name: string; result: string }> | undefined

  beforeEach(() => {
    const orchestrator = new AgentOrchestrator(createMockProvider(), createMockAiService())
    extractToolCalls = (orchestrator as unknown as { extractToolCalls: typeof extractToolCalls })[
      'extractToolCalls'
    ].bind(orchestrator)
  })

  it('只提取当前轮次（最后一条 human 消息之后）的 ToolMessage', () => {
    const messages: BaseMessage[] = [
      new HumanMessage('第一轮'),
      new AIMessage('回复1'),
      new ToolMessage({ content: '旧工具结果', tool_call_id: 'call-1', name: 'oldTool' }),
      new HumanMessage('第二轮'),
      new AIMessage('回复2'),
      new ToolMessage({ content: '新工具结果', tool_call_id: 'call-2', name: 'newTool' }),
    ]

    const result = extractToolCalls(messages)
    expect(result).toHaveLength(1)
    expect(result![0]).toMatchObject({ name: 'newTool', result: '新工具结果' })
  })

  it('没有 human 消息时提取所有 ToolMessage', () => {
    const messages: BaseMessage[] = [
      new ToolMessage({ content: '工具结果', tool_call_id: 'call-1', name: 'singleTool' }),
    ]

    const result = extractToolCalls(messages)
    expect(result).toHaveLength(1)
    expect(result![0]).toMatchObject({ name: 'singleTool', result: '工具结果' })
  })

  it('当前轮次无 ToolMessage 时返回 undefined', () => {
    const messages: BaseMessage[] = [
      new HumanMessage('第一轮'),
      new ToolMessage({ content: '旧工具', tool_call_id: 'call-1', name: 'oldTool' }),
      new HumanMessage('第二轮'),
      new AIMessage('纯文本回复'),
    ]

    const result = extractToolCalls(messages)
    expect(result).toBeUndefined()
  })
})

describe('AgentOrchestrator JSONL 消息持久化', () => {
  it('stream 启动前若 JSONL 中已存在相同用户消息则不再重复保存', async () => {
    const provider = createMockProvider()
    const history = [new HumanMessage('历史消息')]
    const sessionManager = createMockSessionManager(history, [
      ...history,
      new HumanMessage('新消息'),
    ])
    const aiService = createMockAiService(undefined, sessionManager)
    const orchestrator = new AgentOrchestrator(provider, aiService)

    const capturedInputs: Array<{ messages: BaseMessage[] }> = []
    const mockGraph = {
      streamEvents: vi.fn().mockImplementation(async function* (input: {
        messages: BaseMessage[]
      }) {
        capturedInputs.push(input)
        yield { event: 'on_chat_model_stream', data: { chunk: { content: 'ok' } } }
      }),
      getState: vi.fn().mockResolvedValue({
        values: {
          messages: [...history, new HumanMessage('新消息'), new AIMessage('ok')],
          pendingSubgraph: null,
          response: 'ok',
          memoryRoute: [],
          imageUrls: [],
        },
      }),
    }

    ;(orchestrator as unknown as { compiledMainGraph: typeof mockGraph }).compiledMainGraph =
      mockGraph

    await orchestrator.stream(
      { threadId: 'test-thread', message: '新消息' },
      {
        onToken: vi.fn(),
        onToolStart: vi.fn(),
        onToolEnd: vi.fn(),
        onEnd: vi.fn(),
        onError: vi.fn(),
      },
    )

    const savedHuman = sessionManager.saved.filter((m) => m instanceof HumanMessage)
    expect(savedHuman).toHaveLength(0)
    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0].messages).toHaveLength(3)
    expect(capturedInputs[0].messages[1]).toEqual(history[0])
    expect(capturedInputs[0].messages[2]).toBeInstanceOf(HumanMessage)
  })

  it('UI 已保存用户消息后，stream 不应在 JSONL 中产生重复', async () => {
    const provider = createMockProvider()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-dedup-'))
    const sessionManager = new SessionManager()
    await sessionManager.init(tmpDir)
    sessionManager.setWorkspace('/workspace/test')

    const aiService = createMockAiService(
      undefined,
      sessionManager as unknown as ReturnType<typeof createMockSessionManager>,
    )
    const orchestrator = new AgentOrchestrator(provider, aiService)

    const mockGraph = {
      streamEvents: vi.fn().mockImplementation(async function* () {
        yield { event: 'on_chat_model_stream', data: { chunk: { content: 'hi' } } }
      }),
      getState: vi.fn().mockResolvedValue({
        values: {
          messages: [new HumanMessage('hello'), new AIMessage('hi')],
          pendingSubgraph: null,
          response: 'hi',
          memoryRoute: [],
          imageUrls: [],
        },
      }),
    }
    ;(orchestrator as unknown as { compiledMainGraph: typeof mockGraph }).compiledMainGraph =
      mockGraph

    try {
      // 模拟 UI 在点击发送时先保存了用户消息
      await sessionManager.saveSession('thread-dedup', [{ role: 'user', content: 'hello' }])

      await orchestrator.stream(
        { threadId: 'thread-dedup', message: 'hello' },
        {
          onToken: vi.fn(),
          onToolStart: vi.fn(),
          onToolEnd: vi.fn(),
          onEnd: vi.fn(),
          onError: vi.fn(),
        },
      )

      const loaded = await sessionManager.loadSessionBaseMessages('thread-dedup', {
        includeSystem: false,
      })
      const humanMessages = loaded.filter((m) => m.getType() === 'human')
      expect(humanMessages).toHaveLength(1)
    } finally {
      sessionManager.close()
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('图运行结束后将新增的 AI/Tool 消息追加到 JSONL', async () => {
    const provider = createMockProvider()
    const history = [new HumanMessage('历史消息')]
    const sessionManager = createMockSessionManager(history)
    const aiService = createMockAiService(undefined, sessionManager)
    const orchestrator = new AgentOrchestrator(provider, aiService)

    const toolMsg = new ToolMessage({ content: '工具结果', tool_call_id: 'call-1', name: 'tool' })
    const aiMsg = new AIMessage({
      content: '回复',
      tool_calls: [{ id: 'call-1', name: 'tool', args: {} }],
    })
    const mockGraph = {
      streamEvents: vi.fn().mockImplementation(async function* () {
        yield { event: 'on_chat_model_stream', data: { chunk: { content: '回复' } } }
      }),
      getState: vi.fn().mockResolvedValue({
        values: {
          messages: [...history, new HumanMessage('新消息'), aiMsg, toolMsg],
          pendingSubgraph: null,
          response: '回复',
          memoryRoute: [],
          imageUrls: [],
        },
      }),
    }

    ;(orchestrator as unknown as { compiledMainGraph: typeof mockGraph }).compiledMainGraph =
      mockGraph

    await orchestrator.stream(
      { threadId: 'test-thread', message: '新消息' },
      {
        onToken: vi.fn(),
        onToolStart: vi.fn(),
        onToolEnd: vi.fn(),
        onEnd: vi.fn(),
        onError: vi.fn(),
      },
    )

    const savedAi = sessionManager.saved.filter((m) => m instanceof AIMessage)
    const savedTool = sessionManager.saved.filter((m) => m instanceof ToolMessage)
    expect(savedAi).toHaveLength(1)
    expect(savedTool).toHaveLength(1)
  })
})
