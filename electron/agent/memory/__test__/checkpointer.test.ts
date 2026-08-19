import { describe, expect, it, beforeEach } from 'vitest'
import { CheckpointerManager, checkpointMessagesToSessionMessages } from '../checkpointer.js'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
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

  describe('deleteThread', () => {
    it('removes checkpoints', async () => {
      const saver = manager.getAdapter() as SqliteSaver | undefined
      if (!saver) return

      const threadId = 'thread-delete'
      const messages: BaseMessage[] = [new HumanMessage('Hello')]

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

      await manager.deleteThread(threadId)
      const tuple = await saver.getTuple({ configurable: { thread_id: threadId } })
      expect(tuple).toBeUndefined()
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
        tool_calls: [{ id: 'tc1', name: 'foo', args: { bar: 1 } }],
      }),
      new ToolMessage({ content: 'result-foo', tool_call_id: 'tc1' }),
      new AIMessage('Done.'),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: 'Done.',
      toolCalls: [{ name: 'foo', args: { bar: 1 }, result: 'result-foo', status: 'success' }],
    })
  })

  it('skips empty-content AI messages without subsequent content', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'tc1', name: 'foo', args: { bar: 1 } }],
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
        { name: 'searchWeather', args: { city: 'Beijing' }, result: 'Sunny', status: 'success' },
        { name: 'searchMap', args: { location: 'Beijing' }, result: '5km', status: 'success' },
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
        { name: 'search', args: { query: 'foo' }, result: 'search-result', status: 'success' },
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
          {
            type: 'tool_use',
            id: 'tool_abc',
            name: 'generateMindmapFragment',
            input: { source: { type: 'text', content: '内容' } },
          },
        ],
        tool_calls: [
          {
            id: 'tool_abc',
            name: 'generateMindmapFragment',
            args: { source: { type: 'text', content: '内容' } },
          },
        ],
      }),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: '我将为您扩展思维导图。',
      toolCalls: [
        {
          name: 'generateMindmapFragment',
          args: { source: { type: 'text', content: '内容' } },
          result: '',
        },
      ],
    })
  })

  it('rebuilds ChatToolCall.steps from ToolMessage additional_kwargs.toolSteps', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'sc1', name: 'generateMindmapFragment', args: {} }],
      }),
      new ToolMessage({
        content: '{"ok":true}',
        tool_call_id: 'sc1',
        additional_kwargs: {
          toolSteps: [
            { step: 'reading-doc' },
            { step: 'extracting', completed: 1, total: 2 },
            { step: 'merging' },
            { step: 'finalizing' },
          ],
        },
      }),
      new AIMessage('Done.'),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]!.toolCalls).toEqual([
      {
        name: 'generateMindmapFragment',
        args: {},
        result: '{"ok":true}',
        status: 'success',
        steps: [
          { step: 'reading-doc' },
          { step: 'extracting', completed: 1, total: 2 },
          { step: 'merging' },
          { step: 'finalizing' },
        ],
      },
    ])
  })

  it('derives ChatToolCall.status from the tool result ok flag', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'sc1', name: 'updateMindmapNode', args: {} }],
      }),
      new ToolMessage({
        content: '{"ok":false,"error":"[block_not_found] 节点不存在"}',
        tool_call_id: 'sc1',
      }),
      new AIMessage('Done.'),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result[0]!.toolCalls![0]!.status).toBe('error')
  })

  it('leaves ChatToolCall.steps undefined for sessions without a trace', () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'sc1', name: 'generateMindmapFragment', args: {} }],
      }),
      new ToolMessage({ content: 'ok', tool_call_id: 'sc1' }),
      new AIMessage('Done.'),
    ]
    const result = checkpointMessagesToSessionMessages(messages)
    expect(result[0]!.toolCalls![0]!.steps).toBeUndefined()
  })
})
