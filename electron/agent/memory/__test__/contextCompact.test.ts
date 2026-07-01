import { describe, it, expect, vi } from 'vitest'
import {
  RemoveMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { REMOVE_ALL_MESSAGES, messagesStateReducer } from '@langchain/langgraph'
import { AGENT_LIMITS } from '../../config.js'
import { compactContext, isPromptTooLongError, trimToRecentWindow } from '../contextCompact.js'
import type { MainGraphStateType } from '../../state.js'
import type { LLMProvider } from '../../providers/index.js'
import type { StructuredToolInterface } from '@langchain/core/tools'

describe('messagesStateReducer', () => {
  it('replaces all messages when RemoveMessage(REMOVE_ALL_MESSAGES) is passed', () => {
    const existing = [
      new HumanMessage({ content: 'old message 1', id: 'm1' }),
      new AIMessage({ content: 'old reply 1', id: 'm2' }),
      new HumanMessage({ content: 'old message 2', id: 'm3' }),
    ]
    const update = [
      new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
      new HumanMessage({ content: 'new message', id: 'm4' }),
    ]

    const result = messagesStateReducer(existing, update)

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('new message')
  })

  it('appends messages normally without RemoveMessage', () => {
    const existing = [new HumanMessage({ content: 'hello', id: 'm1' })]
    const update = [new AIMessage({ content: 'hi', id: 'm2' })]

    const result = messagesStateReducer(existing, update)

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('hello')
    expect(result[1].content).toBe('hi')
  })
})

describe('AGENT_LIMITS context compact config', () => {
  it('has all required context compact fields', () => {
    expect(AGENT_LIMITS).toHaveProperty('contextWindowTokens')
    expect(AGENT_LIMITS).toHaveProperty('maxCompletionTokens')
    expect(AGENT_LIMITS).toHaveProperty('contextSafetyBufferTokens')
    expect(AGENT_LIMITS).toHaveProperty('contextCompactRecentMessages')
    expect(AGENT_LIMITS).toHaveProperty('reactiveCompactTailMessages')
    expect(AGENT_LIMITS).toHaveProperty('reactiveCompactMaxRetries')
  })

  it('computes inputBudget correctly from defaults', () => {
    const inputBudget =
      AGENT_LIMITS.contextWindowTokens -
      AGENT_LIMITS.maxCompletionTokens -
      AGENT_LIMITS.contextSafetyBufferTokens
    expect(inputBudget).toBe(54976)
  })
})

function createMockProvider(mockInvoke = vi.fn()): LLMProvider {
  return {
    reasoningModel: {
      invoke: mockInvoke,
      bindTools: vi.fn().mockReturnValue({ invoke: mockInvoke }),
    },
    capabilities: new Set(),
    chatModels: [],
  } as unknown as LLMProvider
}

function createMockTool(name: string): StructuredToolInterface {
  return {
    name,
    lc_kwargs: { schema: { type: 'object', properties: {} } },
  } as unknown as StructuredToolInterface
}

function createState(messages: Array<InstanceType<typeof HumanMessage | typeof AIMessage>>): MainGraphStateType {
  return {
    messages,
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
    partialMergedTrees: [],
    mergeResults: [],
    pendingMergeGroups: [],
    finalTree: null,
    documentRef: null,
    palaceInputText: '',
    palaceInputNodes: [],
    palace: null,
    imageUrls: [],
    memoryRoute: [],
  } as MainGraphStateType
}

describe('isPromptTooLongError', () => {
  it('detects prompt_too_long', () => {
    expect(isPromptTooLongError(new Error('prompt_too_long'))).toBe(true)
  })

  it('detects too many tokens', () => {
    expect(isPromptTooLongError(new Error('too many tokens'))).toBe(true)
  })

  it('detects HTTP 413', () => {
    expect(isPromptTooLongError(new Error('Request failed with status 413'))).toBe(true)
  })

  it('detects context length exceeded', () => {
    expect(isPromptTooLongError(new Error('maximum context length exceeded'))).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isPromptTooLongError(new Error('network timeout'))).toBe(false)
  })
})

describe('trimToRecentWindow', () => {
  it('preserves system messages and current user message', () => {
    const messages = [
      new SystemMessage('system'),
      new HumanMessage('msg1'),
      new AIMessage('reply1'),
      new HumanMessage('msg2'),
      new AIMessage('reply2'),
      new HumanMessage('current'),
    ]
    const result = trimToRecentWindow(messages, 2)

    expect(result.some(m => m.type === 'system')).toBe(true)
    expect(result[result.length - 1].content).toBe('current')
  })

  it('keeps only recentCount non-system messages before current user', () => {
    const messages = [
      new HumanMessage('msg1'),
      new AIMessage('reply1'),
      new HumanMessage('msg2'),
      new AIMessage('reply2'),
      new HumanMessage('msg3'),
      new AIMessage('reply3'),
      new HumanMessage('current'),
    ]
    const result = trimToRecentWindow(messages, 2)

    expect(result).toHaveLength(3)
    expect(result[0].content).toBe('msg3')
    expect(result[1].content).toBe('reply3')
    expect(result[2].content).toBe('current')
  })
})

describe('compactContext', () => {
  it('returns empty update when under budget', async () => {
    const provider = createMockProvider()
    const state = createState([
      new HumanMessage('hello'),
    ])

    const result = await compactContext(state, [], provider)

    expect(result.messages).toEqual([])
  })

  it('returns RemoveMessage + compacted messages when over budget', async () => {
    const longText = '这是一个很长的中文测试文本，'.repeat(500)
    const messages: Array<InstanceType<typeof HumanMessage | typeof AIMessage>> = []
    for (let i = 0; i < 50; i++) {
      messages.push(new HumanMessage(`${longText} ${i}`))
      messages.push(new AIMessage(`回复 ${i} ${longText}`))
    }

    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage('对话摘要内容。'),
    )
    const provider = createMockProvider(mockInvoke)
    const state = createState(messages)

    const result = await compactContext(state, [createMockTool('testTool')], provider)

    expect(result.messages).toBeDefined()
    expect(result.messages!.length).toBeGreaterThan(0)
    expect(result.messages![0]).toBeInstanceOf(RemoveMessage)
    expect((result.messages![0] as RemoveMessage).id).toBe(REMOVE_ALL_MESSAGES)
  })
})
