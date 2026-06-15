import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage, ToolMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { preprocessMessages } from '../pipeline.js'
import type { MessagePipelineConfig } from '../pipelineTypes.js'

function makeConfig(partial: Partial<MessagePipelineConfig> = {}): MessagePipelineConfig {
  return {
    enabled: true,
    maxContextTokens: 100,
    toolResultMaxBytes: 1_000,
    microcompactToolNames: ['bigTool'],
    microcompactThreshold: 50,
    microcompactKeepRecent: 1,
    snipPreserveSystem: true,
    snipPreserveLastUser: true,
    ...partial,
  }
}

describe('preprocessMessages', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-preprocess-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

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

    const result = await preprocessMessages(messages, makeConfig({ microcompactKeepRecent: 0 }), tmpDir)

    expect(result.some((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'orphan')).toBe(false)

    const bigToolResults = result.filter(
      (m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-1',
    ) as ToolMessage[]
    expect(bigToolResults.length).toBe(1)
    expect(bigToolResults[0].content).toContain('compressed')
  })

  it('功能关闭时直接返回原数组', async () => {
    const messages = [new HumanMessage('hello')]

    const result = await preprocessMessages(messages, makeConfig({ enabled: false }))

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

    const result = await preprocessMessages(messages, makeConfig(), tmpDir)

    const backfill = result.find((m) => m.type === 'tool' && (m as ToolMessage).tool_call_id === 'call-1')
    expect(backfill).toBeDefined()
    expect((backfill as ToolMessage).content).toContain('unavailable')
  })

  it('drops invalid message-like objects before sending to the model', async () => {
    const messages = [
      new HumanMessage('hello'),
      {} as BaseMessage,
      new AIMessage('hi'),
    ]

    const result = await preprocessMessages(messages, makeConfig(), tmpDir)

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

    const result = await preprocessMessages(messages, makeConfig(), tmpDir)
    const aiMessage = result[0] as AIMessage

    expect(aiMessage.content).toEqual([
      { type: 'text', text: 'using a tool' },
      { type: 'tool_use', id: 'call-1', name: 'tool', input: '' },
    ])
  })
})
