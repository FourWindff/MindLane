import { describe, expect, it, beforeEach } from 'vitest'
import { CheckpointerManager, checkpointMessagesToSessionMessages } from '../checkpointer.js'
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

describe('CheckpointerManager', () => {
  let manager: CheckpointerManager

  beforeEach(async () => {
    manager = new CheckpointerManager()
    try {
      await manager.initWithDbPath(':memory:')
    } catch {
      // better-sqlite3 模块版本不匹配时跳过涉及数据库的测试
    }
  })

  describe('getMessages', () => {
    it('returns empty array for non-existent thread', async () => {
      if (!manager.get()) return
      const messages = await manager.getMessages('non-existent-thread')
      expect(messages).toEqual([])
    })

    it('reads messages from checkpoint (Human + AI)', async () => {
      if (!manager.get()) return

      const threadId = 'thread-1'
      const messages: BaseMessage[] = [
        new HumanMessage('Hello'),
        new AIMessage('Hi there!'),
      ]

      const saver = manager.get()!
      await saver.put(
        { configurable: { thread_id: threadId } },
        {
          v: 1,
          id: 'chk-1',
          ts: new Date().toISOString(),
          channel_values: { messages },
          channel_versions: {},
          versions_seen: {},
        },
        { source: 'input', step: -1, parents: {} },
      )

      const result = await manager.getMessages(threadId)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' })
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there!' })
    })

    it('pairs tool calls with tool results', async () => {
      if (!manager.get()) return

      const threadId = 'thread-tool'
      const messages: BaseMessage[] = [
        new HumanMessage('What is the weather?'),
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call-1', name: 'getWeather', args: { city: 'Beijing' } },
          ],
        }),
        new ToolMessage({
          content: 'Sunny, 25C',
          tool_call_id: 'call-1',
        }),
        new AIMessage('The weather in Beijing is sunny, 25C.'),
      ]

      const saver = manager.get()!
      await saver.put(
        { configurable: { thread_id: threadId } },
        {
          v: 1,
          id: 'chk-1',
          ts: new Date().toISOString(),
          channel_values: { messages },
          channel_versions: {},
          versions_seen: {},
        },
        { source: 'input', step: -1, parents: {} },
      )

      const result = await manager.getMessages(threadId)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ role: 'user', content: 'What is the weather?' })
      expect(result[1]).toEqual({
        role: 'assistant',
        content: 'The weather in Beijing is sunny, 25C.',
        toolCalls: [
          { name: 'getWeather', args: { city: 'Beijing' }, result: 'Sunny, 25C' },
        ],
      })
    })
  })

  describe('getMessageCount', () => {
    it('returns correct count', async () => {
      if (!manager.get()) return

      const threadId = 'thread-count'
      const messages: BaseMessage[] = [
        new HumanMessage('A'),
        new AIMessage('B'),
        new SystemMessage('C'),
      ]

      const saver = manager.get()!
      await saver.put(
        { configurable: { thread_id: threadId } },
        {
          v: 1,
          id: 'chk-1',
          ts: new Date().toISOString(),
          channel_values: { messages },
          channel_versions: {},
          versions_seen: {},
        },
        { source: 'input', step: -1, parents: {} },
      )

      const count = await manager.getMessageCount(threadId)
      expect(count).toBe(3)
    })

    it('returns 0 for non-existent', async () => {
      if (!manager.get()) return
      const count = await manager.getMessageCount('non-existent')
      expect(count).toBe(0)
    })
  })

  describe('deleteThread', () => {
    it('removes checkpoints', async () => {
      if (!manager.get()) return

      const threadId = 'thread-delete'
      const messages: BaseMessage[] = [new HumanMessage('Hello')]

      const saver = manager.get()!
      await saver.put(
        { configurable: { thread_id: threadId } },
        {
          v: 1,
          id: 'chk-1',
          ts: new Date().toISOString(),
          channel_values: { messages },
          channel_versions: {},
          versions_seen: {},
        },
        { source: 'input', step: -1, parents: {} },
      )

      expect(await manager.getMessageCount(threadId)).toBe(1)
      await manager.deleteThread(threadId)
      expect(await manager.getMessageCount(threadId)).toBe(0)
    })
  })
})

describe('checkpointMessagesToSessionMessages', () => {
  it('converts HumanMessage to user role', () => {
    const result = checkpointMessagesToSessionMessages([new HumanMessage('Hello')])
    expect(result).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('converts AIMessage to assistant role', () => {
    const result = checkpointMessagesToSessionMessages([new AIMessage('Hi')])
    expect(result).toEqual([{ role: 'assistant', content: 'Hi' }])
  })

  it('converts SystemMessage to system role', () => {
    const result = checkpointMessagesToSessionMessages([new SystemMessage('Sys')])
    expect(result).toEqual([{ role: 'system', content: 'Sys' }])
  })

  it('merges empty-content AI toolCalls into subsequent AI message', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'tc1', name: 'foo', args: { bar: 1 } },
        ],
      }),
      new ToolMessage({ content: 'result-foo', tool_call_id: 'tc1' }),
      new AIMessage('Done.'),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: 'Done.',
      toolCalls: [{ name: 'foo', args: { bar: 1 }, result: 'result-foo' }],
    })
  })

  it('skips empty-content AI messages without subsequent content', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'tc1', name: 'foo', args: { bar: 1 } },
        ],
      }),
      new ToolMessage({ content: 'result-foo', tool_call_id: 'tc1' }),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(0)
  })

  it('accumulates toolCalls across multiple empty AI messages', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'tc1', name: 'searchWeather', args: { city: 'Beijing' } }],
      }),
      new ToolMessage({ content: 'Sunny', tool_call_id: 'tc1' }),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'tc2', name: 'searchMap', args: { location: 'Beijing' } }],
      }),
      new ToolMessage({ content: '5km', tool_call_id: 'tc2' }),
      new AIMessage('Weather is good and it is 5km away.'),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: 'Weather is good and it is 5km away.',
      toolCalls: [
        { name: 'searchWeather', args: { city: 'Beijing' }, result: 'Sunny' },
        { name: 'searchMap', args: { location: 'Beijing' }, result: '5km' },
      ],
    })
  })

  it('merges pending toolCalls with current AI message toolCalls', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'tc1', name: 'search', args: { query: 'foo' } }],
      }),
      new ToolMessage({ content: 'search-result', tool_call_id: 'tc1' }),
      new AIMessage({
        content: 'Here is the result, let me save it.',
        tool_calls: [{ id: 'tc2', name: 'save', args: { data: 'foo' } }],
      }),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: 'Here is the result, let me save it.',
      toolCalls: [
        { name: 'search', args: { query: 'foo' }, result: 'search-result' },
        { name: 'save', args: { data: 'foo' }, result: '' },
      ],
    })
  })

  it('skips ToolMessages without matching AI message', () => {
    const messages: BaseMessage[] = [
      new HumanMessage('Hello'),
      new ToolMessage({ content: 'orphan', tool_call_id: 'orphan-id' }),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'Hello' })
  })

  it('extracts text from array-format AIMessage content (Anthropic format)', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: [
          { type: 'text', text: '我将为您扩展思维导图。' },
          { type: 'tool_use', id: 'tool_abc', name: 'routeDecision', input: { target: 'mindmap' } },
        ],
        tool_calls: [{ id: 'tool_abc', name: 'routeDecision', args: { target: 'mindmap' } }],
      }),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: '我将为您扩展思维导图。',
      toolCalls: [{ name: 'routeDecision', args: { target: 'mindmap' }, result: '' }],
    })
  })
})
