import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage, ToolMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  prepareMessagesForModel,
  dropOrphanToolResults,
  backfillMissingToolResults,
  microcompact,
  applyToolResultBudget,
  snipHistory,
  mergeMessagePreparationConfig,
} from '../messagePreparation.js'
import type { MessagePreparationConfig } from '../messagePreparation.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-message-preparation-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeConfig(partial: Partial<MessagePreparationConfig> = {}): MessagePreparationConfig {
  return {
    enabled: true,
    inputBudgetTokens: 100,
    toolResultMaxBytes: 1_000,
    microcompactToolNames: ['bigTool'],
    microcompactThreshold: 50,
    microcompactKeepRecent: 1,
    snipPreserveSystem: true,
    snipPreserveLastUser: true,
    ...partial,
  }
}

describe('prepareMessagesForModel', () => {
  it('按固定顺序执行预处理步骤', async () => {
    const messages = [
      new SystemMessage('system'),
      new HumanMessage('hello'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'bigTool', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', name: 'bigTool', content: 'x'.repeat(200) }),
      new ToolMessage({ tool_call_id: 'orphan', content: 'orphan-result' }),
    ]

    const result = await prepareMessagesForModel(
      messages,
      makeConfig({ microcompactKeepRecent: 0 }),
      tmpDir,
    )

    expect(
      result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'orphan'),
    ).toBe(false)

    const bigToolResults = result.filter(
      (m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-1',
    ) as ToolMessage[]
    expect(bigToolResults.length).toBe(1)
    expect(bigToolResults[0].content).toContain('compressed')
  })

  it('功能关闭时直接返回原数组', async () => {
    const messages = [new HumanMessage('hello')]

    const result = await prepareMessagesForModel(messages, makeConfig({ enabled: false }))

    expect(result).toBe(messages)
  })

  it('缺失的 tool_result 被补全', async () => {
    const messages = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'tool', args: {}, type: 'tool_call' }],
      }),
      new HumanMessage('next'),
    ]

    const result = await prepareMessagesForModel(messages, makeConfig(), tmpDir)

    const backfill = result.find(
      (m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-1',
    )
    expect(backfill).toBeDefined()
    expect((backfill as ToolMessage).content).toContain('unavailable')
  })

  it('drops invalid message-like objects before sending to the model', async () => {
    const messages = [new HumanMessage('hello'), {} as BaseMessage, new AIMessage('hi')]

    const result = await prepareMessagesForModel(messages, makeConfig(), tmpDir)

    expect(result).toHaveLength(2)
    expect(result.map((m) => m.type)).toEqual(['human', 'ai'])
  })

  it('sanitizes invalid Anthropic content blocks from replayed AI messages', async () => {
    const messages = [
      new AIMessage({
        content: [
          { type: 'text', text: 'using a tool' },
          { type: 'tool_use', id: 'call-1', name: 'tool', input: '' },
          { index: 1, type: 'input_json_delta', input: '{"query":"x"}' },
        ],
        tool_calls: [{ id: 'call-1', name: 'tool', args: { query: 'x' }, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', name: 'tool', content: 'ok' }),
    ]

    const result = await prepareMessagesForModel(messages, makeConfig(), tmpDir)
    const aiMessage = result[0] as AIMessage

    expect(aiMessage.content).toEqual([
      { type: 'text', text: 'using a tool' },
      { type: 'tool_use', id: 'call-1', name: 'tool', input: '' },
    ])
  })
})

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
    expect(
      result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'orphan'),
    ).toBe(false)
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

    expect(
      result.map((m) => (m.type === 'tool' ? (m as ToolMessage).tool_call_id : m.type)),
    ).toEqual(['ai', 'call-1', 'call-2'])
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

    expect(
      result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'orphan'),
    ).toBe(false)
    expect(
      result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-2'),
    ).toBe(true)
  })
})

describe('microcompact', () => {
  function makeConfig(partial: Partial<MessagePreparationConfig> = {}): MessagePreparationConfig {
    return {
      enabled: true,
      inputBudgetTokens: 16_000,
      toolResultMaxBytes: 8_000,
      microcompactToolNames: ['bigTool'],
      microcompactThreshold: 100,
      microcompactKeepRecent: 2,
      snipPreserveSystem: true,
      snipPreserveLastUser: true,
      ...partial,
    }
  }

  it('压缩命中名单且超过阈值的工具结果', () => {
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'bigTool', content: 'x'.repeat(200) }),
    ]

    const result = microcompact(messages, makeConfig({ microcompactKeepRecent: 0 }))

    expect((result[0] as ToolMessage).content).toContain('compressed')
  })

  it('不压缩未命中名单的工具', () => {
    const original = 'x'.repeat(200)
    const messages = [new ToolMessage({ tool_call_id: 't1', name: 'otherTool', content: original })]

    const result = microcompact(messages, makeConfig())

    expect((result[0] as ToolMessage).content).toBe(original)
  })

  it('空工具名单不作为通配名单', () => {
    const original = 'x'.repeat(200)
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'searchKnowledge', content: original }),
    ]

    const result = microcompact(
      messages,
      makeConfig({ microcompactToolNames: [], microcompactKeepRecent: 0 }),
    )

    expect((result[0] as ToolMessage).content).toBe(original)
  })

  it('保留最近 N 条完整结果', () => {
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'bigTool', content: 'x'.repeat(200) }),
      new ToolMessage({ tool_call_id: 't2', name: 'bigTool', content: 'y'.repeat(200) }),
      new ToolMessage({ tool_call_id: 't3', name: 'bigTool', content: 'z'.repeat(200) }),
    ]

    const result = microcompact(messages, makeConfig({ microcompactKeepRecent: 2 }))

    expect((result[0] as ToolMessage).content).toContain('compressed')
    expect((result[1] as ToolMessage).content).toBe('y'.repeat(200))
    expect((result[2] as ToolMessage).content).toBe('z'.repeat(200))
  })

  it('不压缩未超过阈值的内容', () => {
    const original = 'short'
    const messages = [new ToolMessage({ tool_call_id: 't1', name: 'bigTool', content: original })]

    const result = microcompact(messages, makeConfig())

    expect((result[0] as ToolMessage).content).toBe(original)
  })
})

describe('applyToolResultBudget', () => {
  function makeConfig(partial: Partial<MessagePreparationConfig> = {}): MessagePreparationConfig {
    return {
      enabled: true,
      inputBudgetTokens: 16_000,
      toolResultMaxBytes: 8_000,
      microcompactToolNames: ['bigTool'],
      microcompactThreshold: 100,
      microcompactKeepRecent: 2,
      snipPreserveSystem: true,
      snipPreserveLastUser: true,
      ...partial,
    }
  }

  it('不压缩在预算内的 tool_result', async () => {
    const original = 'small result'
    const messages = [new ToolMessage({ tool_call_id: 't1', name: 'tool', content: original })]

    const result = await applyToolResultBudget(
      messages,
      makeConfig({ toolResultMaxBytes: 1000 }),
      tmpDir,
    )

    expect((result[0] as ToolMessage).content).toBe(original)
  })

  it('超限内容写入磁盘并用引用替换', async () => {
    const original = 'x'.repeat(20_000)
    const messages = [new ToolMessage({ tool_call_id: 't1', name: 'tool', content: original })]

    const result = await applyToolResultBudget(
      messages,
      makeConfig({ toolResultMaxBytes: 1000 }),
      tmpDir,
    )

    const toolMsg = result[0] as ToolMessage
    expect(toolMsg.content).toContain('exceeded')
    expect(toolMsg.content).toContain('message-pipeline-offloads')

    const match = (toolMsg.content as string).match(/Full content offloaded to: (.+)/)
    expect(match).toBeTruthy()
    const filePath = match![1].trim()
    const restored = await fs.readFile(filePath, 'utf8')
    expect(restored).toBe(original)
  })

  it('没有 userDataPath 时回退到截断', async () => {
    const original = 'x'.repeat(20_000)
    const messages = [new ToolMessage({ tool_call_id: 't1', name: 'tool', content: original })]

    const result = await applyToolResultBudget(messages, makeConfig({ toolResultMaxBytes: 1000 }))

    const toolMsg = result[0] as ToolMessage
    expect(toolMsg.content).toContain('exceeded')
    expect(toolMsg.content).toContain('Offload to disk failed')
  })
})

describe('snipHistory', () => {
  function makeConfig(partial: Partial<MessagePreparationConfig> = {}): MessagePreparationConfig {
    return {
      enabled: true,
      inputBudgetTokens: 100,
      toolResultMaxBytes: 8_000,
      microcompactToolNames: [],
      microcompactThreshold: 4_000,
      microcompactKeepRecent: 3,
      snipPreserveSystem: true,
      snipPreserveLastUser: true,
      ...partial,
    }
  }

  it('未超预算时保留所有消息', () => {
    const messages = [new SystemMessage('system'), new HumanMessage('hello'), new AIMessage('hi')]

    const result = snipHistory(messages, makeConfig({ inputBudgetTokens: 10_000 }))

    expect(result).toHaveLength(3)
  })

  it('超预算时保留 system 和最后一条 user 消息', () => {
    const messages = [
      new SystemMessage('system'),
      new HumanMessage('old'),
      new AIMessage('old reply'),
      new HumanMessage('current'),
    ]

    const result = snipHistory(messages, makeConfig({ inputBudgetTokens: 20 }))

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

    const result = snipHistory(messages, makeConfig({ inputBudgetTokens: 10 }))

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

    const result = snipHistory(messages, makeConfig({ inputBudgetTokens: 10 }))

    expect(
      result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-2'),
    ).toBe(false)
  })

  it('允许关闭 system 保留', () => {
    const messages = [new SystemMessage('system'), new HumanMessage('current')]

    const result = snipHistory(
      messages,
      makeConfig({ inputBudgetTokens: 5, snipPreserveSystem: false }),
    )

    expect(result.some((m) => m.type === 'system')).toBe(false)
  })
})

describe('mergeMessagePreparationConfig', () => {
  it('未显式给预算时从模型窗口推导，且始终小于窗口', () => {
    const config = mergeMessagePreparationConfig(undefined, 32_768)

    expect(config.inputBudgetTokens).toBe(23_744)
    expect(config.inputBudgetTokens).toBeLessThan(32_768)
  })

  it('显式给出的输入预算优先于推导值', () => {
    const config = mergeMessagePreparationConfig({ inputBudgetTokens: 20 }, 1_000_000)

    expect(config.inputBudgetTokens).toBe(20)
  })
})
