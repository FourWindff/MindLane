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
import { ToolRegistry } from '../../../tools/registry.js'
import { REMOVE_ALL_MESSAGES, Send } from '@langchain/langgraph'
import type { MainGraphStateType } from '../../../state.js'

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
  description: 'Search the knowledge base',
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
    pendingSubgraphs: [],
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
    palaceLandingError: '',
    palaceToolCallId: '',
    palaceToolName: '',
    palaceInputText: '',
    palaceInputNodes: [],
    palace: null,
    imageUrls: [],
    imageError: undefined,
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
          { type: 'text', text: 'I will generate a mindmap from the PDF' },
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
    expect(result.pendingSubgraphs).toEqual(['mindmap'])
    expect(result.mindmapToolCallId).toBe('call-1')
    expect(result.mindmapToolName).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
    expect(result.mindmapInputSource).toBeUndefined()
    expect(result.mindmapInputTitle).toBeUndefined()
    expect(result.messages).toHaveLength(1)
    const savedMessage = result.messages?.[0] as AIMessage
    expect(savedMessage.content).toBe('I will generate a mindmap from the PDF')
    expect(savedMessage.tool_calls?.[0]?.name).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
  })

  it('routes generatePalace to palace subgraph', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: 'I will generate the memory palace',
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

    expect(result.pendingSubgraphs).toEqual(['palace'])
    expect(result.palaceToolCallId).toBe('call-2')
    expect(result.palaceToolName).toBe(GENERATE_PALACE_TOOL)
    expect(result.palaceInputText).toBeUndefined()
    expect(result.palaceInputNodes).toBeUndefined()
  })

  it('returns ordinary tool calls for ToolNode execution', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: 'Let me search for that',
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
    expect(result.pendingSubgraphs).toEqual([])
  })

  it('keeps the subgraph call when the same round also declares a plain tool', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: 'Read the map first, then generate',
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
    expect(result.pendingSubgraphs).toEqual(['mindmap'])
    expect(result.mindmapToolCallId).toBe('call-2')
  })

  it('declares both subgraphs when the model asks for both', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: 'Do both',
        tool_calls: [
          { name: GENERATE_MINDMAP_FRAGMENT_TOOL, args: {}, id: 'call-mm', type: 'tool_call' },
          { name: GENERATE_PALACE_TOOL, args: {}, id: 'call-pl', type: 'tool_call' },
        ],
      }),
    )
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

    const result = await agent.invoke(createInitialState())

    expect(result.pendingSubgraphs).toEqual(['mindmap', 'palace'])
    expect(result.mindmapToolCallId).toBe('call-mm')
    expect(result.palaceToolCallId).toBe('call-pl')
  })

  it('direct response ends without subgraph routing', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(new AIMessage({ content: 'Here is an answer' }))
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

    const result = await agent.invoke(createInitialState())

    expect(result.pendingSubgraphs).toEqual([])
    expect(result.response).toBe('Here is an answer')
  })

  it('surfaces a failed subgraph as the turn answer without calling the model', async () => {
    const mockInvoke = vi.fn()
    const agent = new MindLaneAgent(
      createMockProvider(mockInvoke),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state = {
      ...createInitialState(),
      mindmapError: '[xml_parse_error] tag <node> is not closed',
      mindmapResponse: 'Failed to generate the mindmap: no valid structure was produced',
    }

    const result = await agent.invoke(state)

    expect(mockInvoke).not.toHaveBeenCalled()
    expect((result.messages?.[0] as AIMessage).content).toBe(
      'Failed to generate the mindmap: no valid structure was produced',
    )
    expect(result.response).toBe('Failed to generate the mindmap: no valid structure was produced')
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
      undefined,
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
  it('dispatches each ordinary tool call as its own Send to the tools node', () => {
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

    const destinations = agent.route(state)

    expect(destinations).toHaveLength(1)
    const send = destinations[0] as Send
    expect(send.node).toBe('tools')
    expect(send.args).toMatchObject({ lg_tool_call: { id: 'call-1', name: 'searchKnowledge' } })
  })

  it('routes a pending mindmap subgraph', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state: MainGraphStateType = {
      ...createInitialState(),
      pendingSubgraphs: ['mindmap'],
    }

    expect(agent.route(state)).toEqual(['mindmapSubgraph'])
  })

  it('routes both pending subgraphs in the same super-step', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state: MainGraphStateType = {
      ...createInitialState(),
      pendingSubgraphs: ['mindmap', 'palace'],
    }

    expect(agent.route(state)).toEqual(['mindmapSubgraph', 'palaceSubgraph'])
  })

  it('routes a plain tool and a subgraph together', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state: MainGraphStateType = {
      ...createInitialState(),
      pendingSubgraphs: ['palace'],
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
            { name: GENERATE_PALACE_TOOL, args: {}, id: 'call-2', type: 'tool_call' },
          ],
        }),
      ],
    }

    const destinations = agent.route(state)

    expect(destinations).toHaveLength(2)
    expect((destinations[0] as Send).node).toBe('tools')
    expect(destinations[1]).toBe('palaceSubgraph')
  })

  it('ends when there is no pending subgraph or action tool', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )

    expect(agent.route(createInitialState())).toEqual(['__end__'])
  })

  it('routes palace regardless of provider capabilities', () => {
    const agent = new MindLaneAgent(
      createMockProvider(vi.fn()),
      createTestRegistry({ extraTools: [mockSearchTool] }),
    )
    const state: MainGraphStateType = {
      ...createInitialState(),
      pendingSubgraphs: ['palace'],
    }

    expect(agent.route(state)).toEqual(['palaceSubgraph'])
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
    // More messages than contextCompactRecentMessages(10), so the trim window really kicks in
    state.messages = Array.from({ length: 7 }, (_, i) => [
      new HumanMessage(`msg${i}`),
      new AIMessage(`reply${i}`),
    ]).flat()
    state.messages.push(new HumanMessage('current'))

    const result = await agent.invoke(state)

    // First call fails; the second call succeeds after trimming
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.response).toBe('Compacted response')

    // The retry carries fewer messages than the first call (window trimming took effect)
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

    // First failure + failed trim retry -> gives up after 2 calls total
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.error).toBeDefined()
    expect(result.response).toContain('Something went wrong while processing the request')
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
    expect(result.response).toContain('Something went wrong while processing the request')
  })

  it('injects the rolling summary into the system prompt as History Summary', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(new AIMessage({ content: 'ok' }))

    const provider = createMockProvider(mockInvoke)
    const agent = new MindLaneAgent(provider, createTestRegistry({ extraTools: [mockSearchTool] }))

    const state = createInitialState()
    state.summary = 'The user is organizing a mindmap about knowledge management.'

    const result = await agent.invoke(state)
    expect(result.response).toBe('ok')

    const systemPrompt = mockInvoke.mock.calls[0][0][0].content as string
    expect(systemPrompt).toContain('## History Summary')
    expect(systemPrompt).toContain('The user is organizing a mindmap about knowledge management.')
  })
})
