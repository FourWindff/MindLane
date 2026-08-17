import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage } from '@langchain/core/messages'
import { MemoryExtractor } from '../memoryExtractor.js'
import { MemoryManager } from '../memoryManager.js'
import type { LLMProvider } from '../../providers/index.js'

// Minimal mock provider for testing
interface MockProvider {
  model: {
    invoke: (messages: unknown[]) => Promise<{ content: string }>
  }
}

function createMockProvider(responseContent: string): MockProvider {
  return {
    model: {
      invoke: vi.fn().mockResolvedValue({ content: responseContent }),
    },
  }
}

function memoryFilePath(tempDir: string): string {
  return path.join(tempDir, 'mindlanememory', 'MEMORY.md')
}
describe('MemoryExtractor', () => {
  let tempDir: string
  let manager: MemoryManager

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `ml-ext-${Date.now()}`)
    await fs.promises.mkdir(tempDir, { recursive: true })
    manager = new MemoryManager(tempDir)
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('merges new facts with existing memory and rewrites MEMORY.md', async () => {
    await manager.writeMemory('用户偏好模块化设计')
    const mockProvider = createMockProvider(
      JSON.stringify({
        facts: ['用户偏好模块化设计', '用户偏好先跑 MVP 再迭代'],
      }),
    )

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('先做个最小版本试试')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toBe(
      '用户偏好模块化设计\n用户偏好先跑 MVP 再迭代\n',
    )
  })

  it('keeps existing memory when LLM returns empty facts', async () => {
    await manager.writeMemory('用户偏好模块化设计')
    const mockProvider = createMockProvider('{"facts": []}')

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('hello')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toBe(
      '用户偏好模块化设计\n',
    )
  })

  it('creates MEMORY.md from scratch when no existing memory', async () => {
    const mockProvider = createMockProvider(JSON.stringify({ facts: ['用户偏好时间轴叙事'] }))

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('帮我梳理时间线')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toBe(
      '用户偏好时间轴叙事\n',
    )
  })

  it('strips EDITOR_STATE blocks from evidence before prompting', async () => {
    const turnStateSuffix =
      '\n<EDITOR_STATE file_uuid="f" file_path="/a.mindlane" file_title="t">\n<SELECTED_NODES count="1">\n  <node id="n1" type="text" label="旧节点"/>\n</SELECTED_NODES>\n</EDITOR_STATE>'
    const mockProvider = createMockProvider('{"facts": []}')
    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage(`我们把导图拆成模块${turnStateSuffix}`)],
      editlogEntries: [],
    })

    const invokeSpy = mockProvider.model.invoke as unknown as ReturnType<typeof vi.fn>
    const prompt = String(invokeSpy.mock.calls[0]![0][0].content)
    expect(prompt).toContain('我们把导图拆成模块')
    expect(prompt).not.toContain('<EDITOR_STATE')
    expect(prompt).not.toContain('<SELECTED_NODES')
    expect(prompt).not.toContain('旧节点')
  })

  it('includes editlog entries in the prompt', async () => {
    const mockProvider = createMockProvider('{"facts": []}')
    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('改一下节点')],
      editlogEntries: [{ ts: 1, nodeId: 'n1', before: 'AI 写的', after: '用户改的' }],
    })

    const invokeSpy = mockProvider.model.invoke as unknown as ReturnType<typeof vi.fn>
    const prompt = String(invokeSpy.mock.calls[0]![0][0].content)
    expect(prompt).toContain('节点 n1')
    expect(prompt).toContain('「AI 写的」→「用户改的」')
  })

  it('parses markdown code fenced JSON responses', async () => {
    const mockProvider = createMockProvider('```json\n{"facts": ["用户偏好快速验证"]}\n```')

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('先做个最小版本试试')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toContain(
      '用户偏好快速验证',
    )
  })

  it('ignores malformed LLM responses without clobbering memory', async () => {
    await manager.writeMemory('既有事实')
    const mockProvider = createMockProvider('not json at all')

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('hello')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toBe('既有事实\n')
  })
})
