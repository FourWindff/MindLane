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
  applyToolResultBudget,
  snipHistory,
  messagePreparationConfig,
} from './messagePreparation.js'
import type { MessagePreparationConfig } from './messagePreparation.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-message-preparation-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeConfig(partial: Partial<MessagePreparationConfig> = {}): MessagePreparationConfig {
  return {
    inputBudgetTokens: 100,
    toolResultMaxBytes: 1_000,
    ...partial,
  }
}

describe('prepareMessagesForModel', () => {
  it('runs the preparation steps in a fixed order', async () => {
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
      makeConfig({ toolResultMaxBytes: 50 }),
      tmpDir,
    )

    expect(
      result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'orphan'),
    ).toBe(false)

    const bigToolResults = result.filter(
      (m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-1',
    ) as ToolMessage[]
    expect(bigToolResults.length).toBe(1)
    expect(bigToolResults[0].content).toContain('exceeded')
  })

  it('backfills a missing tool_result', async () => {
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
  it('drops orphan tool_results with no matching tool_use', () => {
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

  it('keeps every fully paired tool_result', () => {
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
  it('inserts a placeholder result for a tool_use missing its tool_result', () => {
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

  it('does not backfill a result that already exists', () => {
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

  it('preserves message order', () => {
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

  it('handles mixed scenarios', () => {
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

describe('applyToolResultBudget', () => {
  function makeConfig(partial: Partial<MessagePreparationConfig> = {}): MessagePreparationConfig {
    return {
      inputBudgetTokens: 16_000,
      toolResultMaxBytes: 8_000,
      ...partial,
    }
  }

  it('does not compress a tool_result within budget', async () => {
    const original = 'small result'
    const messages = [new ToolMessage({ tool_call_id: 't1', name: 'tool', content: original })]

    const result = await applyToolResultBudget(
      messages,
      makeConfig({ toolResultMaxBytes: 1000 }),
      tmpDir,
    )

    expect((result[0] as ToolMessage).content).toBe(original)
  })

  it('writes oversized content to disk and replaces it with a reference', async () => {
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

  it('falls back to truncation without a userDataPath', async () => {
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
      inputBudgetTokens: 100,
      toolResultMaxBytes: 8_000,
      ...partial,
    }
  }

  it('keeps every message while under budget', () => {
    const messages = [new SystemMessage('system'), new HumanMessage('hello'), new AIMessage('hi')]

    const result = snipHistory(messages, makeConfig({ inputBudgetTokens: 10_000 }))

    expect(result).toHaveLength(3)
  })

  it('keeps system and the last user message when over budget', () => {
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

  it('repairs tool_use / tool_result pairing after truncation', () => {
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

  it('drops orphan tool_results after truncation', () => {
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
})

describe('messagePreparationConfig', () => {
  it('derives the budget from the model window, always below the window', () => {
    const config = messagePreparationConfig(32_768)

    expect(config.inputBudgetTokens).toBe(23_744)
    expect(config.inputBudgetTokens).toBeLessThan(32_768)
    expect(config.toolResultMaxBytes).toBe(8_000)
  })
})
