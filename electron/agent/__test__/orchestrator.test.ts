import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatToolCallStep } from '../../../src/shared/lib/fileFormat.js'
import type { AgentServices } from '../service.js'
import { ProviderCapability, type LLMProvider } from '../providers/index.js'
import { AgentOrchestrator } from '../orchestrator.js'
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

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
    model: mockModel,
    visionModel: undefined,
    capabilities,
    models: [],
  } as unknown as LLMProvider
}

// 边界 cast（唯一谎言点）：graph 结构测试从不运行提取回调等真实服务路径。
function createMockServices(checkpointer?: unknown): AgentServices {
  return {
    checkpointer: {
      getAdapter: vi.fn().mockReturnValue(checkpointer),
    },
  } as unknown as AgentServices
}

// ─── 测试 ────────────────────────────────────────────────────

describe('AgentOrchestrator 编译缓存', () => {
  let provider: LLMProvider
  let services: AgentServices
  let orchestrator: AgentOrchestrator

  beforeEach(() => {
    provider = createMockProvider()
    services = createMockServices()
    orchestrator = new AgentOrchestrator(provider, services)
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
    orchestrator = new AgentOrchestrator(provider, services)
    const getCompiledPalaceSubgraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'getCompiledPalaceSubgraph'
    ].bind(orchestrator)
    expect(getCompiledPalaceSubgraph()).toBe(getCompiledPalaceSubgraph())
  })
})

describe('AgentOrchestrator buildGraph 结构', () => {
  it('无论 hasPalace 如何，graph 节点结构完全一致', () => {
    const providerWithPalace = createMockProvider(
      new Set([ProviderCapability.Chat, ProviderCapability.ImageGen, ProviderCapability.Vision]),
    )
    const providerWithoutPalace = createMockProvider(new Set([ProviderCapability.Chat]))

    const orchestratorWith = new AgentOrchestrator(providerWithPalace, createMockServices())
    const orchestratorWithout = new AgentOrchestrator(providerWithoutPalace, createMockServices())

    const buildGraphWith = (
      orchestratorWith as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestratorWith)
    const buildGraphWithout = (
      orchestratorWithout as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestratorWithout)

    const graphWith = buildGraphWith()
    const graphWithout = buildGraphWithout()

    expect(Object.keys(graphWith.nodes)).toContain('palaceSubgraph')
    expect(Object.keys(graphWith.nodes)).toContain('subgraphResult')
    expect(Object.keys(graphWithout.nodes)).toContain('palaceSubgraph')
    expect(Object.keys(graphWith.nodes)).toEqual(Object.keys(graphWithout.nodes))
  })

  it('隔离独立子图的回调，避免父流重复结束同一 run', async () => {
    const provider = createMockProvider()
    const orchestrator = new AgentOrchestrator(provider, createMockServices())
    const invoke = vi.fn().mockResolvedValue({ messages: [], response: 'done' })

    vi.spyOn(
      orchestrator as unknown as { getCompiledMindmapSubgraph: () => { invoke: typeof invoke } },
      'getCompiledMindmapSubgraph',
    ).mockReturnValue({ invoke })

    const graph = orchestrator.buildGraph()
    const node = graph.nodes.mindmapSubgraph as unknown as {
      runnable: { invoke: (state: Record<string, unknown>) => Promise<unknown> }
    }
    await node.runnable.invoke({ messages: [] })

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [] }),
      expect.objectContaining({ callbacks: [] }),
    )
  })
})

describe('AgentOrchestrator contextCompact node', () => {
  it('graph includes contextCompact node', () => {
    const provider = createMockProvider()
    const orchestrator = new AgentOrchestrator(provider, createMockServices())

    const buildGraph = (
      orchestrator as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestrator)
    const graph = buildGraph()

    expect(Object.keys(graph.nodes)).toContain('contextCompact')
  })

  it('START edge points to contextCompact, not supervisor', () => {
    const provider = createMockProvider()
    const orchestrator = new AgentOrchestrator(provider, createMockServices())

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

describe('AgentOrchestrator extractToolCalls', () => {
  let extractToolCalls: (
    msgs: BaseMessage[],
  ) => Array<{ name: string; result: string; steps?: ChatToolCallStep[] }> | undefined

  beforeEach(() => {
    const orchestrator = new AgentOrchestrator(createMockProvider(), createMockServices())
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

  it('读取 additional_kwargs.toolSteps 为 ChatToolCall.steps', () => {
    const messages: BaseMessage[] = [
      new ToolMessage({
        content: '{"ok":true}',
        tool_call_id: 'call-sc1',
        name: 'generateMindmapFragment',
        additional_kwargs: {
          toolSteps: [
            { step: 'reading-doc' },
            { step: 'extracting', completed: 1, total: 1 },
            { step: 'finalizing' },
          ],
        },
      }),
    ]

    const result = extractToolCalls(messages)
    expect(result![0].steps).toEqual([
      { step: 'reading-doc' },
      { step: 'extracting', completed: 1, total: 1 },
      { step: 'finalizing' },
    ])
  })

  it('无轨迹（旧会话）ToolMessage 不产生 steps', () => {
    const messages: BaseMessage[] = [
      new ToolMessage({
        content: 'ok',
        tool_call_id: 'call-sc2',
        name: 'generateMindmapFragment',
      }),
    ]

    const result = extractToolCalls(messages)
    expect(result![0].steps).toBeUndefined()
  })
})
