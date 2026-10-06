import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage } from '@langchain/core/messages'
import { MemoryExtractor } from './memoryExtractor.js'
import { MemoryManager } from './memoryManager.js'
import type { LLMProvider } from '../providers/index.js'

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
    await manager.writeMemory('The user prefers modular design')
    const mockProvider = createMockProvider(
      JSON.stringify({
        facts: [
          'The user prefers modular design',
          'The user prefers shipping an MVP first, then iterating',
        ],
      }),
    )

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('Let us try the smallest version first')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toBe(
      'The user prefers modular design\nThe user prefers shipping an MVP first, then iterating\n',
    )
  })

  it('keeps existing memory when LLM returns empty facts', async () => {
    await manager.writeMemory('The user prefers modular design')
    const mockProvider = createMockProvider('{"facts": []}')

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('hello')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toBe(
      'The user prefers modular design\n',
    )
  })

  it('creates MEMORY.md from scratch when no existing memory', async () => {
    const mockProvider = createMockProvider(
      JSON.stringify({ facts: ['The user prefers timeline narratives'] }),
    )

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('Help me sort out the timeline')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toBe(
      'The user prefers timeline narratives\n',
    )
  })

  it('strips EDITOR_STATE blocks from evidence before prompting', async () => {
    const turnStateSuffix =
      '\n<EDITOR_STATE file_uuid="f" file_path="/a.mindlane" file_title="t">\n<SELECTED_NODES count="1">\n  <node id="n1" type="text" label="old node"/>\n</SELECTED_NODES>\n</EDITOR_STATE>'
    const mockProvider = createMockProvider('{"facts": []}')
    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage(`We split the mindmap into modules${turnStateSuffix}`)],
      editlogEntries: [],
    })

    const invokeSpy = mockProvider.model.invoke as unknown as ReturnType<typeof vi.fn>
    const prompt = String(invokeSpy.mock.calls[0]![0][0].content)
    expect(prompt).toContain('We split the mindmap into modules')
    expect(prompt).not.toContain('<EDITOR_STATE')
    expect(prompt).not.toContain('<SELECTED_NODES')
    expect(prompt).not.toContain('old node')
  })

  it('includes editlog entries in the prompt', async () => {
    const mockProvider = createMockProvider('{"facts": []}')
    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('Edit the node')],
      editlogEntries: [{ ts: 1, nodeId: 'n1', before: 'AI-written', after: 'User-edited' }],
    })

    const invokeSpy = mockProvider.model.invoke as unknown as ReturnType<typeof vi.fn>
    const prompt = String(invokeSpy.mock.calls[0]![0][0].content)
    expect(prompt).toContain('Node n1')
    expect(prompt).toContain('"AI-written" → "User-edited"')
  })

  it('parses markdown code fenced JSON responses', async () => {
    const mockProvider = createMockProvider(
      '```json\n{"facts": ["The user prefers fast validation"]}\n```',
    )

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('Let us try the smallest version first')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toContain(
      'The user prefers fast validation',
    )
  })

  it('ignores malformed LLM responses without clobbering memory', async () => {
    await manager.writeMemory('Existing fact')
    const mockProvider = createMockProvider('not json at all')

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('hello')],
      editlogEntries: [],
    })

    expect(await fs.promises.readFile(memoryFilePath(tempDir), 'utf-8')).toBe('Existing fact\n')
  })
})
