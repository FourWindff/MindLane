import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ToolMessage } from '@langchain/core/messages'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { microcompact, applyToolResultBudget } from '../pipelineCompaction.js'
import type { MessagePipelineConfig } from '../pipelineTypes.js'

function makeConfig(partial: Partial<MessagePipelineConfig> = {}): MessagePipelineConfig {
  return {
    enabled: true,
    maxContextTokens: 16_000,
    toolResultMaxBytes: 8_000,
    microcompactToolNames: ['bigTool'],
    microcompactThreshold: 100,
    microcompactKeepRecent: 2,
    snipPreserveSystem: true,
    snipPreserveLastUser: true,
    ...partial,
  }
}

describe('microcompact', () => {
  it('压缩命中名单且超过阈值的工具结果', () => {
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'bigTool', content: 'x'.repeat(200) }),
    ]

    const result = microcompact(messages, makeConfig({ microcompactKeepRecent: 0 }))

    expect((result[0] as ToolMessage).content).toContain('compressed')
  })

  it('不压缩未命中名单的工具', () => {
    const original = 'x'.repeat(200)
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'otherTool', content: original }),
    ]

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
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'bigTool', content: original }),
    ]

    const result = microcompact(messages, makeConfig())

    expect((result[0] as ToolMessage).content).toBe(original)
  })
})

describe('applyToolResultBudget', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-pipeline-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('不压缩在预算内的 tool_result', async () => {
    const original = 'small result'
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'tool', content: original }),
    ]

    const result = await applyToolResultBudget(messages, makeConfig({ toolResultMaxBytes: 1000 }), tmpDir)

    expect((result[0] as ToolMessage).content).toBe(original)
  })

  it('超限内容写入磁盘并用引用替换', async () => {
    const original = 'x'.repeat(20_000)
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'tool', content: original }),
    ]

    const result = await applyToolResultBudget(messages, makeConfig({ toolResultMaxBytes: 1000 }), tmpDir)

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
    const messages = [
      new ToolMessage({ tool_call_id: 't1', name: 'tool', content: original }),
    ]

    const result = await applyToolResultBudget(messages, makeConfig({ toolResultMaxBytes: 1000 }))

    const toolMsg = result[0] as ToolMessage
    expect(toolMsg.content).toContain('exceeded')
    expect(toolMsg.content).toContain('Offload to disk failed')
  })
})

