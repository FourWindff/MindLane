import { describe, it, expect } from 'vitest'
import { AIMessage, ToolMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { snipHistory } from '../pipelineSnip.js'
import type { MessagePipelineConfig } from '../pipelineTypes.js'

function makeConfig(partial: Partial<MessagePipelineConfig> = {}): MessagePipelineConfig {
  return {
    enabled: true,
    maxContextTokens: 100,
    toolResultMaxBytes: 8_000,
    microcompactToolNames: [],
    microcompactThreshold: 4_000,
    microcompactKeepRecent: 3,
    snipPreserveSystem: true,
    snipPreserveLastUser: true,
    ...partial,
  }
}

describe('snipHistory', () => {
  it('未超预算时保留所有消息', () => {
    const messages = [
      new SystemMessage('system'),
      new HumanMessage('hello'),
      new AIMessage('hi'),
    ]

    const result = snipHistory(messages, makeConfig({ maxContextTokens: 10_000 }))

    expect(result).toHaveLength(3)
  })

  it('超预算时保留 system 和最后一条 user 消息', () => {
    const messages = [
      new SystemMessage('system'),
      new HumanMessage('old'),
      new AIMessage('old reply'),
      new HumanMessage('current'),
    ]

    const result = snipHistory(messages, makeConfig({ maxContextTokens: 20 }))

    expect(result.some((m) => m.type === 'system')).toBe(true)
    expect(result[result.length - 1].content).toBe('current')
  })

  it('截断后修复 tool_use / tool_result 配对', () => {
    const messages = [
      new SystemMessage('system'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'tool', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: 'result' }),
      new HumanMessage('current'),
    ]

    const result = snipHistory(messages, makeConfig({ maxContextTokens: 10 }))

    const toolCalls = result.filter((m) => m.type === 'ai')
    const toolResults = result.filter((m) => m.type === 'tool')
    expect(toolResults.length).toBe(toolCalls.length)
  })

  it('截断后删除孤儿 tool_result', () => {
    const messages = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'tool', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: 'result' }),
      new ToolMessage({ tool_call_id: 'call-2', content: 'orphan' }),
      new HumanMessage('current'),
    ]

    const result = snipHistory(messages, makeConfig({ maxContextTokens: 10 }))

    expect(result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-2')).toBe(false)
  })

  it('允许关闭 system 保留', () => {
    const messages = [
      new SystemMessage('system'),
      new HumanMessage('current'),
    ]

    const result = snipHistory(messages, makeConfig({ maxContextTokens: 5, snipPreserveSystem: false }))

    expect(result.some((m) => m.type === 'system')).toBe(false)
  })
})
