import { describe, it, expect, vi } from 'vitest'
import { AIMessage, HumanMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { MindLaneAgent } from '../mindlaneAgent.js'
import type { LLMProvider } from '../../../providers/index.js'
import {
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
  getToolSchemas,
} from '../../../subgraphRouter.js'
import { createMindmapActionTools } from '../../../tools/mindmapActions.js'
import { mergeMessagePreparationConfig } from '../../../context/messagePreparation.js'
import { ToolRegistry } from '../../../tools/registry.js'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'

function createMockProvider(mockInvoke: ReturnType<typeof vi.fn>): LLMProvider {
  return {
    model: {
      bindTools: () => ({ invoke: mockInvoke }),
    },
    capabilities: new Set(),
    models: [],
  } as unknown as LLMProvider
}

const mockSearchTool = new DynamicStructuredTool({
  name: 'searchKnowledge',
  description: '搜索知识库',
  schema: z.object({ query: z.string() }),
  func: async (input) => JSON.stringify({ results: [`result for ${input.query}`] }),
})

function createTestRegistry(
  options: { extraTools?: StructuredToolInterface[] } = {},
): ToolRegistry {
  const registry = new ToolRegistry()

  const actionTools = createMindmapActionTools(async () => ({
    nodeIds: ['root'],
    assetIds: [],
    parents: {},
  }))
  registry.registerTool(actionTools.insertXmlFragmentTool)
  registry.registerTool(actionTools.updateNodeTool)
  registry.registerTool(actionTools.moveNodeTool)
  registry.registerTool(actionTools.deleteNodeTool)

  const schemas = getToolSchemas()
  for (const tool of schemas) {
    registry.registerTool(tool)
  }

  options.extraTools?.forEach((t) => registry.registerTool(t))
  return registry
}

function createInitialState() {
  return {
    messages: [new HumanMessage('hello')] as BaseMessage[],
    context: null,
    pendingSubgraph: null,
    response: '',
    error: '',
    mindmapInputSource: null,
    mindmapInputTitle: '',
    mindmapXml: '',
    mindmapTitle: '',
    documentBatches: [],
    batchIndex: -1,
    leafResults: [],
    mergeInputs: [],
    mergeGroup: null,
    mergeResults: [],
    finalTree: null,
    documentRef: null,
    mindmapToolSteps: [],
    mindmapError: '',
    mindmapResponse: '',
    mindmapToolCallId: '',
    mindmapToolName: '',
    palaceToolSteps: [],
    palaceError: '',
    palaceResponse: '',
    palaceToolCallId: '',
    palaceToolName: '',
    palaceInputText: '',
    palaceInputNodes: [],
    memoryItems: [],
    palace: null,
    imagePrompt: '',
    imageUrls: [],
    imageError: undefined,
    detectedCoords: [],
    memoryRoute: [],
    artworkStyle: 'vector' as const,
    summary: '',
    runEntry: 'chat' as const,
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
        ],
        tool_calls: [
          {
            name: GENERATE_MINDMAP_FRAGMENT_TOOL,
            args: {},
            id: 'call-1',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

    const result = await agent.invoke(createInitialState())

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(result.pendingSubgraph).toBe('mindmap')
    expect(result.mindmapToolCallId).toBe('call-1')
    expect(result.mindmapToolName).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
    expect(result.mindmapInputSource).toBeUndefined()
    expect(result.mindmapInputTitle).toBeUndefined()
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
            args: {},
            id: 'call-2',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

    const result = await agent.invoke(createInitialState())

    expect(result.pendingSubgraph).toBe('palace')
    expect(result.palaceToolCallId).toBe('call-2')
    expect(result.palaceToolName).toBe(GENERATE_PALACE_TOOL)
    expect(result.palaceInputText).toBeUndefined()
    expect(result.palaceInputNodes).toBeUndefined()
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
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

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
            args: {},
            id: 'call-2',
            type: 'tool_call',
          },
        ],
      }),
    )
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

    const result = await agent.invoke(createInitialState())

    expect(result.messages).toHaveLength(1)
    expect(result.pendingSubgraph).toBeUndefined()
  })

  it('direct response ends without subgraph routing', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(new AIMessage({ content: '这是一个回答' }))
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

    const result = await agent.invoke(createInitialState())

    expect(result.pendingSubgraph).toBeNull()
    expect(result.response).toBe('这是一个回答')
  })

  it('surfaces a failed subgraph as the turn answer without calling the model', async () => {
    const mockInvoke = vi.fn()
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state = {
      ...createInitialState(),
      mindmapError: '[xml_parse_error] 标签 <node> 未闭合',
      mindmapResponse: '生成思维导图失败：未能生成有效的结构',
    }

    const result = await agent.invoke(state)

    expect(mockInvoke).not.toHaveBeenCalled()
    expect((result.messages?.[0] as AIMessage).content).toBe('生成思维导图失败：未能生成有效的结构')
    expect(result.response).toBe('生成思维导图失败：未能生成有效的结构')
    expect(result.mindmapError).toBe('')
  })

  it('always exposes generatePalace alongside the other virtual route', () => {
    const registry = createTestRegistry({ extraTools: [mockSearchTool] })

    expect(registry.allTools.some((tool) => tool.name === GENERATE_MINDMAP_FRAGMENT_TOOL)).toBe(
      true,
    )
    expect(registry.allTools.some((tool) => tool.name === GENERATE_PALACE_TOOL)).toBe(true)
  })

  it('does not duplicate chat history in the system prompt', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(new AIMessage({ content: 'ok' }))
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
      undefined,
      {
        messagePipeline: mergeMessagePreparationConfig(
          { inputBudgetTokens: 20, toolResultMaxBytes: 0, microcompactToolNames: [] },
          32_768,
        ),
      },
    )
    const state = createInitialState()
    state.messages = [
      new HumanMessage('old private history '.repeat(80)),
      new AIMessage('old assistant reply '.repeat(80)),
      new HumanMessage('current request'),
    ]

    await agent.invoke(state)

    const invokedMessages = mockInvoke.mock.calls[0][0] as BaseMessage[]
    const systemPrompt = invokedMessages[0].content as string
    const messageContents = invokedMessages.slice(1).map((m) => String(m.content))
    expect(systemPrompt).not.toContain('<HISTORY>')
    expect(systemPrompt).not.toContain('old private history')
    expect(systemPrompt).not.toContain('current request')
    expect(messageContents).toContain('current request')
  })

  it('redacts message content in model error logs', async () => {
    const privateText = 'PRIVATE_DOCUMENT_CONTENT_SHOULD_NOT_BE_LOGGED_' + 'x'.repeat(500)
    const mockInvoke = vi.fn().mockRejectedValue(new Error('network timeout'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state = createInitialState()
    state.messages = [new HumanMessage(privateText)]

    await agent.invoke(state)

    const logged = errorSpy.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(' '))
      .join('\n')
    expect(logged).not.toContain(privateText)
    expect(logged).toContain('PRIVATE_DOCUMENT_CONTENT_SHOULD_NOT_BE_LOGGED_')

    errorSpy.mockRestore()
  })
})

describe('MindLaneAgent.route()', () => {
  it('routes ordinary tool calls to tools', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
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
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state = {
      ...createInitialState(),
      pendingSubgraph: 'mindmap' as const,
    }

    expect(agent.route(state)).toBe('mindmapSubgraph')
  })

  it('routes pending palace subgraph', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state = {
      ...createInitialState(),
      pendingSubgraph: 'palace' as const,
    }

    expect(agent.route(state)).toBe('palaceSubgraph')
  })

  it('ends when there is no pending subgraph or action tool', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

    expect(agent.route(createInitialState())).toBe('__end__')
  })

  it('routes palace regardless of provider capabilities', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state = {
      ...createInitialState(),
      pendingSubgraph: 'palace' as const,
    }

    expect(agent.route(state)).toBe('palaceSubgraph')
  })
})

describe('MindLaneAgent trim retry', () => {
  it('trims to recent window and retries once on prompt-too-long error', async () => {
    const error = new Error('prompt_too_long')
    const mockInvoke = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(new AIMessage({ content: 'Compacted response' }))

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, createTestRegistry({ extraTools: [mockSearchTool] }))

    const state = createInitialState()
    // 超过 contextCompactRecentMessages(10) 的消息，让裁剪窗口真实生效
    state.messages = Array.from({ length: 7 }, (_, i) => [
      new HumanMessage(`msg${i}`),
      new AIMessage(`reply${i}`),
    ]).flat()
    state.messages.push(new HumanMessage('current'))

    const result = await agent.invoke(state)

    // 第一次调用失败，第二次裁剪后重试成功
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.response).toBe('Compacted response')

    // 重试输入的消息数应少于首次（窗口裁剪生效）
    const firstCallMessages = mockInvoke.mock.calls[0][0]
    const retryCallMessages = mockInvoke.mock.calls[1][0]
    expect(retryCallMessages.length).toBeLessThan(firstCallMessages.length)
  })

  it('returns RemoveMessage + trimmed + response after trim retry', async () => {
    const error = new Error('prompt_too_long')
    const mockInvoke = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(new AIMessage({ content: 'Retry success' }))

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, createTestRegistry({ extraTools: [mockSearchTool] }))

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

  it('gives up after the single trim retry also fails', async () => {
    const error = new Error('prompt_too_long')
    const mockInvoke = vi.fn().mockRejectedValue(error)

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, createTestRegistry({ extraTools: [mockSearchTool] }))

    const state = createInitialState()
    state.messages = [
      new HumanMessage('msg1'),
      new AIMessage('reply1'),
      new HumanMessage('current'),
    ]

    const result = await agent.invoke(state)

    // 首次失败 + 裁剪重试失败 -> 共 2 次调用后放弃
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.error).toBeDefined()
    expect(result.response).toContain('处理请求时出错')
  })

  it('does not trigger trim retry on non-context errors', async () => {
    const error = new Error('model connection refused')
    const mockInvoke = vi.fn().mockRejectedValue(error)

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, createTestRegistry({ extraTools: [mockSearchTool] }))

    const result = await agent.invoke(createInitialState())

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('model connection refused')
    expect(result.error).toContain('at')
    expect(result.response).toContain('处理请求时出错')
  })

  it('injects the rolling summary into the system prompt as 历史摘要', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(new AIMessage({ content: 'ok' }))

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, createTestRegistry({ extraTools: [mockSearchTool] }))

    const state = createInitialState()
    state.summary = '用户正在整理一份关于知识管理的思维导图。'

    const result = await agent.invoke(state)
    expect(result.response).toBe('ok')

    const systemPrompt = mockInvoke.mock.calls[0][0][0].content as string
    expect(systemPrompt).toContain('## 历史摘要')
    expect(systemPrompt).toContain('用户正在整理一份关于知识管理的思维导图。')
  })
})
