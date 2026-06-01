import { describe, it, expect, vi } from 'vitest'
import { AIMessage, HumanMessage, RemoveMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { MindLaneAgent } from '../mindlaneAgent.js'
import type { LLMProvider } from '../../../providers/index.js'
import {
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
} from '../../../tools/subgraphRoutingTools.js'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'
import { isPromptTooLongError } from '../../../memory/contextCompact.js'

function createMockProvider(mockInvoke: ReturnType<typeof vi.fn>): LLMProvider {
  return {
    reasoningModel: {
      bindTools: () => ({ invoke: mockInvoke }),
    },
    capabilities: new Set(),
    chatModels: [],
  } as unknown as LLMProvider
}

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
    pendingSubgraph: null,
    pendingSubgraphToolCallId: '',
    pendingSubgraphToolName: '',
    response: '',
    error: '',
    mindmapInputSource: null,
    mindmapInputTitle: '',
    mindmapYaml: '',
    mindmapTitle: '',
    documentChunks: [],
    leafCursor: 0,
    pendingLeafRange: null,
    leafResults: [],
    mergeInputs: [],
    mergeResults: [],
    pendingMergeGroups: [],
    finalTree: null,
    documentRef: null,
    palaceInputText: '',
    palaceInputNodes: [],
    palace: null,
    imageUrls: [],
    memoryRoute: [],
  }
}

describe('MindLaneAgent.invoke()', () => {
  it('routes generateMindmapFragment to mindmap subgraph', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: [
          { type: 'text', text: '我来从 PDF 生成思维导图' },
          {
            type: 'tool_use',
            id: 'call-1',
            name: GENERATE_MINDMAP_FRAGMENT_TOOL,
            input: '',
          },
          {
            index: 1,
            type: 'input_json_delta',
            input: '{"source":{"type":"pdf","path":"/test.pdf"}}',
          },
        ],
        tool_calls: [
          {
            name: GENERATE_MINDMAP_FRAGMENT_TOOL,
            args: {
              source: { type: 'pdf', path: '/test.pdf' },
              title: 'PDF 导图',
            },
            id: 'call-1',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])

    const result = await agent.invoke(createInitialState())

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(result.pendingSubgraph).toBe('mindmap')
    expect(result.pendingSubgraphToolCallId).toBe('call-1')
    expect(result.pendingSubgraphToolName).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
    expect(result.mindmapInputSource).toEqual({ type: 'pdf', path: '/test.pdf' })
    expect(result.mindmapInputTitle).toBe('PDF 导图')
    expect(result.messages).toHaveLength(1)
    const savedMessage = result.messages?.[0] as AIMessage
    expect(savedMessage.content).toBe('我来从 PDF 生成思维导图')
    expect(savedMessage.tool_calls?.[0]?.name).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
  })

  it('routes generatePalace to palace subgraph', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: '我来生成记忆宫殿',
        tool_calls: [
          {
            name: GENERATE_PALACE_TOOL,
            args: {
              inputText: '记忆材料',
              inputNodes: [{ id: 'n1', label: '节点1' }],
            },
            id: 'call-2',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])

    const result = await agent.invoke(createInitialState())

    expect(result.pendingSubgraph).toBe('palace')
    expect(result.pendingSubgraphToolCallId).toBe('call-2')
    expect(result.pendingSubgraphToolName).toBe(GENERATE_PALACE_TOOL)
    expect(result.palaceInputText).toBe('记忆材料')
    expect(result.palaceInputNodes).toEqual([{ id: 'n1', label: '节点1' }])
  })

  it('returns ordinary tool calls for ToolNode execution', async () => {
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

    const result = await agent.invoke(createInitialState())

    expect(result.messages).toHaveLength(1)
    expect(result.pendingSubgraph).toBeUndefined()
  })

  it('ordinary tool calls take precedence over virtual routing tools', async () => {
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
            name: GENERATE_MINDMAP_FRAGMENT_TOOL,
            args: { source: { type: 'text', content: 'AI 基础知识' } },
            id: 'call-2',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])

    const result = await agent.invoke(createInitialState())

    expect(result.messages).toHaveLength(1)
    expect(result.pendingSubgraph).toBeUndefined()
  })

  it('direct response ends without subgraph routing', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({ content: '这是一个回答' }),
    )
    const agent = new MindLaneAgent(createMockProvider(mockInvoke), [mockSearchTool])

    const result = await agent.invoke(createInitialState())

    expect(result.pendingSubgraph).toBeNull()
    expect(result.response).toBe('这是一个回答')
  })

  it('does not expose generatePalace when palace is disabled', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      [mockSearchTool],
      { hasEmbeddings: true, hasPalace: false },
    )

    const tools = (agent as unknown as { tools: Array<{ name: string }> }).tools

    expect(tools.some((tool) => tool.name === GENERATE_MINDMAP_FRAGMENT_TOOL)).toBe(true)
    expect(tools.some((tool) => tool.name === GENERATE_PALACE_TOOL)).toBe(false)
  })
})

describe('MindLaneAgent.route()', () => {
  it('routes ordinary tool calls to tools', () => {
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
    }

    expect(agent.route(state)).toBe('tools')
  })

  it('routes pending mindmap subgraph', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])
    const state = {
      ...createInitialState(),
      pendingSubgraph: 'mindmap' as const,
    }

    expect(agent.route(state)).toBe('mindmapSubgraph')
  })

  it('routes pending palace subgraph', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])
    const state = {
      ...createInitialState(),
      pendingSubgraph: 'palace' as const,
    }

    expect(agent.route(state)).toBe('palaceSubgraph')
  })

  it('ends when there is no pending subgraph or action tool', () => {
    const agent = new MindLaneAgent(createMockProvider(vi.fn()), [mockSearchTool])

    expect(agent.route(createInitialState())).toBe('__end__')
  })

  it('disabled palace falls back to end', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      [mockSearchTool],
      { hasEmbeddings: true, hasPalace: false },
    )
    const state = {
      ...createInitialState(),
      pendingSubgraph: 'palace' as const,
    }

    expect(agent.route(state)).toBe('__end__')
  })
})

describe('MindLaneAgent reactive compact', () => {
  it('triggers reactive compact on prompt-too-long error', async () => {
    const error = new Error('prompt_too_long')
    const mockInvoke = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(
        new AIMessage({ content: 'Compacted response' }),
      )

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, [mockSearchTool])

    const state = createInitialState()
    // Fill state with enough messages to make compact believable
    state.messages = [
      new HumanMessage('msg1'),
      new AIMessage('reply1'),
      new HumanMessage('msg2'),
      new AIMessage('reply2'),
      new HumanMessage('msg3'),
      new AIMessage('reply3'),
      new HumanMessage('current'),
    ]

    const result = await agent.invoke(state)

    // Should have retried: first call fails, second succeeds
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.response).toBe('Compacted response')
  })

  it('returns RemoveMessage + compacted + response after reactive compact', async () => {
    const error = new Error('prompt_too_long')
    const mockInvoke = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(
        new AIMessage({ content: 'Retry success' }),
      )

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, [mockSearchTool])

    const state = createInitialState()
    state.messages = [
      new HumanMessage('old1'),
      new AIMessage('old reply'),
      new HumanMessage('recent1'),
      new AIMessage('recent reply'),
      new HumanMessage('current'),
    ]

    const result = await agent.invoke(state)

    expect(result.messages).toBeDefined()
    expect(result.messages!.length).toBeGreaterThan(1)
    expect(result.messages![0]).toBeInstanceOf(RemoveMessage)
    expect((result.messages![0] as RemoveMessage).id).toBe(REMOVE_ALL_MESSAGES)
  })

  it('retries at most once for reactive compact', async () => {
    const error = new Error('prompt_too_long')
    const mockInvoke = vi.fn().mockRejectedValue(error)

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, [mockSearchTool])

    const state = createInitialState()
    state.messages = [
      new HumanMessage('msg1'),
      new AIMessage('reply1'),
      new HumanMessage('current'),
    ]

    const result = await agent.invoke(state)

    // First call fails, retry once, then gives up -> 2 calls total
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.error).toBeDefined()
    expect(result.response).toContain('处理请求时出错')
  })

  it('does not trigger reactive compact on non-context errors', async () => {
    const error = new Error('network timeout')
    const mockInvoke = vi.fn().mockRejectedValue(error)

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, [mockSearchTool])

    const result = await agent.invoke(createInitialState())

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(result.error).toBeDefined()
    expect(result.response).toContain('处理请求时出错')
  })
})
