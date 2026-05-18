import { describe, it, expect, vi } from 'vitest'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { MindLaneAgent } from '../mindlaneAgent.js'
import type { LLMProvider } from '../../../providers/index.js'

// ===== Mock Provider =====
function createMockProvider(mockInvoke: ReturnType<typeof vi.fn>): LLMProvider {
  return {
    reasoningModel: {
      bindTools: () => ({ invoke: mockInvoke }),
    },
    capabilities: new Set(),
    chatModels: [],
  } as unknown as LLMProvider
}

// ===== Mock Tool =====
const mockSearchTool = new DynamicStructuredTool({
  name: 'searchKnowledge',
  description: '搜索知识库',
  schema: z.object({ query: z.string() }),
  func: async (input) => JSON.stringify({ results: [`result for ${input.query}`] }),
})

function createInitialState() {
  return {
    messages: [new HumanMessage('hello')],
    context: null,
    intent: 'qa' as const,
    response: '',
    error: '',
    mindmapInputText: '',
    mindmapInputTitle: '',
    mindmapNodes: [],
    mindmapEdges: [],
    mindmapTitle: '',
    palaceInputText: '',
    palaceInputNodes: [],
    imageUrls: [],
    memoryRoute: [],
  }
}

describe('MindLaneAgent.invoke()', () => {
  it('直接处理 routeDecision 工具调用，不走 ToolNode', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: '我来为你生成思维导图',
        tool_calls: [
          {
            name: 'routeDecision',
            args: {
              target: 'mindmap',
              parameters: {
                mindmapInput: 'AI 基础知识',
                mindmapTitle: 'AI 导图',
              },
            },
            id: 'call-1',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])
    const state = createInitialState()

    const result = await agent.invoke(state)

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(result.intent).toBe('mindmap')
    expect(result.mindmapInputText).toBe('AI 基础知识')
    expect(result.mindmapInputTitle).toBe('AI 导图')
    expect(result.messages).toHaveLength(1)
  })

  it('普通工具调用时返回 messages 走 ToolNode', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: '让我搜索一下',
        tool_calls: [
          {
            name: 'searchKnowledge',
            args: { query: 'test' },
            id: 'call-1',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])
    const state = createInitialState()

    const result = await agent.invoke(state)

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(result.messages).toHaveLength(1)
    expect(result.intent).toBeUndefined()
  })

  it('同时有 routeDecision 和普通工具时优先走 ToolNode', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: '搜索后再生成',
        tool_calls: [
          {
            name: 'searchKnowledge',
            args: { query: 'test' },
            id: 'call-1',
            type: 'tool_call',
          },
          {
            name: 'routeDecision',
            args: { target: 'mindmap' },
            id: 'call-2',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])
    const state = createInitialState()

    const result = await agent.invoke(state)

    expect(result.messages).toHaveLength(1)
    expect(result.intent).toBeUndefined()
  })

  it('无工具调用时默认 QA', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({ content: '这是一个回答' }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])
    const state = createInitialState()

    const result = await agent.invoke(state)

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(result.intent).toBe('qa')
    expect(result.response).toBe('这是一个回答')
  })

  it('mindmapInput 未提供时回退到 content', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: '生成思维导图',
        tool_calls: [
          {
            name: 'routeDecision',
            args: { target: 'mindmap' },
            id: 'call-1',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])
    const state = createInitialState()

    const result = await agent.invoke(state)

    expect(result.intent).toBe('mindmap')
    expect(result.mindmapInputText).toBe('生成思维导图')
  })

  it('禁用 palace 时不应包含 palace 路由选项', () => {
    const mockInvoke = vi.fn()
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      [mockSearchTool],
      undefined,
      { hasEmbeddings: true, hasPalace: false },
    )

    const routeTool = (agent as unknown as { tools: Array<{ name: string; description: string }> }).tools.find(
      (t) => t.name === 'routeDecision',
    )

    expect(routeTool).toBeDefined()
    expect(routeTool!.description).not.toContain('palace')
    expect(routeTool!.description).toContain('mindmap')
  })
})

describe('MindLaneAgent.route()', () => {
  it('过滤 routeDecision 的 tool_calls，只剩下普通工具时走 tools', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])

    const state = {
      ...createInitialState(),
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'searchKnowledge',
              args: { query: 'test' },
              id: 'call-1',
              type: 'tool_call',
            },
          ],
        }),
      ],
      intent: 'qa' as const,
    }

    expect(agent.route(state)).toBe('tools')
  })

  it('只有 routeDecision tool_call 时按 intent 路由', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])

    const state = {
      ...createInitialState(),
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'routeDecision',
              args: { target: 'mindmap' },
              id: 'call-1',
              type: 'tool_call',
            },
          ],
        }),
      ],
      intent: 'mindmap' as const,
    }

    expect(agent.route(state)).toBe('mindmapSubgraph')
  })

  it('只有 routeDecision tool_call + intent=qa 时返回 __end__', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])

    const state = {
      ...createInitialState(),
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'routeDecision',
              args: { target: 'qa' },
              id: 'call-1',
              type: 'tool_call',
            },
          ],
        }),
      ],
    }

    expect(agent.route(state)).toBe('__end__')
  })

  it('tool result 返回 "supervisor"', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])

    const state = {
      ...createInitialState(),
      messages: [
        new ToolMessage({
          content: '搜索结果',
          tool_call_id: 'call-1',
        }),
      ],
    }

    expect(agent.route(state)).toBe('supervisor')
  })

  it('intent=mindmap 返回 "mindmapSubgraph"', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])

    const state = {
      ...createInitialState(),
      intent: 'mindmap' as const,
    }

    expect(agent.route(state)).toBe('mindmapSubgraph')
  })

  it('intent=palace 返回 "palaceSubgraph"', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])

    const state = {
      ...createInitialState(),
      intent: 'palace' as const,
    }

    expect(agent.route(state)).toBe('palaceSubgraph')
  })

  it('intent=qa 返回 "__end__"', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])

    const state = createInitialState()

    expect(agent.route(state)).toBe('__end__')
  })

  it('禁用 palace 时 intent=palace 回退到 __end__', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      [mockSearchTool],
      undefined,
      { hasEmbeddings: true, hasPalace: false },
    )

    const state = {
      ...createInitialState(),
      intent: 'palace' as const,
    }

    expect(agent.route(state)).toBe('__end__')
  })
})
