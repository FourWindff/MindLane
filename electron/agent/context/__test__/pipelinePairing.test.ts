import { describe, it, expect } from 'vitest'
import { AIMessage, ToolMessage, HumanMessage } from '@langchain/core/messages'
import {
  dropOrphanToolResults,
  backfillMissingToolResults,
} from '../pipelinePairing.js'

describe('dropOrphanToolResults', () => {
  it('删除没有对应 tool_use 的孤儿 tool_result', () => {
    const messages = [
      new HumanMessage('hello'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'x' }, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: 'result-1' }),
      new ToolMessage({ tool_call_id: 'orphan', content: 'orphan-result' }),
    ]

    const result = dropOrphanToolResults(messages)

    expect(result).toHaveLength(3)
    expect(result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'orphan')).toBe(false)
  })

  it('保留所有配对完整的 tool_result', () => {
    const messages = [
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'call-1', name: 'a', args: {}, type: 'tool_call' },
          { id: 'call-2', name: 'b', args: {}, type: 'tool_call' },
        ],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: 'r1' }),
      new ToolMessage({ tool_call_id: 'call-2', content: 'r2' }),
    ]

    const result = dropOrphanToolResults(messages)

    expect(result).toHaveLength(3)
  })
})

describe('backfillMissingToolResults', () => {
  it('为缺失 tool_result 的 tool_use 插入占位结果', () => {
    const messages = [
      new HumanMessage('hello'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'x' }, type: 'tool_call' }],
      }),
    ]

    const result = backfillMissingToolResults(messages)

    expect(result).toHaveLength(3)
    const backfill = result[2] as ToolMessage
    expect(backfill.type).toBe('tool')
    expect(backfill.tool_call_id).toBe('call-1')
    expect(backfill.content).toContain('unavailable')
  })

  it('不重复补全已有结果', () => {
    const messages = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'search', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: 'result' }),
    ]

    const result = backfillMissingToolResults(messages)

    expect(result).toHaveLength(2)
  })

  it('保持消息顺序', () => {
    const messages = [
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'call-1', name: 'a', args: {}, type: 'tool_call' },
          { id: 'call-2', name: 'b', args: {}, type: 'tool_call' },
        ],
      }),
      new ToolMessage({ tool_call_id: 'call-2', content: 'r2' }),
    ]

    const result = backfillMissingToolResults(messages)

    expect(result.map((m) => (m.type === 'tool' ? (m as ToolMessage).tool_call_id : m.type))).toEqual([
      'ai',
      'call-1',
      'call-2',
    ])
  })

  it('处理混合场景', () => {
    const messages = [
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'call-1', name: 'a', args: {}, type: 'tool_call' },
          { id: 'call-2', name: 'b', args: {}, type: 'tool_call' },
        ],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: 'r1' }),
      new ToolMessage({ tool_call_id: 'orphan', content: 'orphan' }),
    ]

    const dropped = dropOrphanToolResults(messages)
    const result = backfillMissingToolResults(dropped)

    expect(result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'orphan')).toBe(false)
    expect(result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-2')).toBe(true)
  })
})
