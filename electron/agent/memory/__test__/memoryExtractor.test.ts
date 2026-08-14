import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { MemoryExtractor } from '../memoryExtractor.js'
import { MemoryManager } from '../memoryManager.js'
import type { LLMProvider } from '../../providers/index.js'
import type { MindLaneFile } from '../../../../src/shared/lib/fileFormat.js'

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

function makeMindlaneFile(): MindLaneFile {
  return {
    version: '1.0',
    metadata: {
      fileUuid: 'file-uuid-1',
      title: 'Test',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    mindmap: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    documents: [],
  }
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

  it('persist writes patterns to memory files and updates index', async () => {
    const extractor = new MemoryExtractor(manager)
    await extractor.persist([
      {
        discipline: 'engineering',
        subTag: 'modular',
        description: '用户偏好模块化',
        observation: '倾向组件化设计',
      },
    ])

    const index = await manager.loadIndex()
    expect(index).toContain('engineering-modular')

    const content = await fs.promises.readFile(
      path.join(tempDir, 'mindlanememory', 'engineering-modular.md'),
      'utf-8',
    )
    expect(content).toContain('倾向组件化设计')
  })

  it('extractAndPersist calls LLM, persists patterns, and updates .mindlane tags', async () => {
    const mindlanePath = path.join(tempDir, 'test.mindlane')
    await fs.promises.writeFile(mindlanePath, JSON.stringify(makeMindlaneFile(), null, 2), 'utf-8')

    const mockResponse = JSON.stringify({
      disciplines: [
        {
          name: 'engineering',
          patterns: [
            {
              subTag: 'modular',
              description: '用户偏好模块化',
              observation: '倾向组件化设计',
              evidence: ['我们把这个拆成几个模块'],
            },
          ],
        },
      ],
    })
    const mockProvider = createMockProvider(mockResponse)

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [
        new HumanMessage('我们把这个拆成几个模块来做'),
        new AIMessage('好的，我来帮你设计模块结构'),
      ],
      editlogEntries: [],
      filePath: mindlanePath,
    })

    // Verify memory file was created
    const index = await manager.loadIndex()
    expect(index).toContain('engineering-modular')

    // Verify .mindlane file was updated with discipline tag
    const updatedRaw = await fs.promises.readFile(mindlanePath, 'utf-8')
    const updated = JSON.parse(updatedRaw) as MindLaneFile
    expect(updated.metadata.tags).toContain('engineering')
  })

  it('extractAndPersist handles empty LLM response gracefully', async () => {
    const mindlanePath = path.join(tempDir, 'empty.mindlane')
    await fs.promises.writeFile(mindlanePath, JSON.stringify(makeMindlaneFile(), null, 2), 'utf-8')

    const mockProvider = createMockProvider('{"disciplines": []}')

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('hello')],
      editlogEntries: [],
      filePath: mindlanePath,
    })

    // No memory file should be created
    const index = await manager.loadIndex()
    expect(index).toBe('')
  })

  it('extractAndPersist merges new discipline tags with existing ones', async () => {
    const mindlaneFile = makeMindlaneFile()
    mindlaneFile.metadata.tags = ['humanities']
    const mindlanePath = path.join(tempDir, 'merge.mindlane')
    await fs.promises.writeFile(mindlanePath, JSON.stringify(mindlaneFile, null, 2), 'utf-8')

    const mockResponse = JSON.stringify({
      disciplines: [
        {
          name: 'engineering',
          patterns: [
            {
              subTag: 'modular',
              description: '用户偏好模块化',
              observation: '倾向组件化设计',
            },
          ],
        },
      ],
    })
    const mockProvider = createMockProvider(mockResponse)

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('拆模块')],
      editlogEntries: [],
      filePath: mindlanePath,
    })

    const updatedRaw = await fs.promises.readFile(mindlanePath, 'utf-8')
    const updated = JSON.parse(updatedRaw) as MindLaneFile
    expect(updated.metadata.tags).toContain('humanities')
    expect(updated.metadata.tags).toContain('engineering')
  })

  it('extractAndPersist 剥离证据消息末尾的 EDITOR_STATE 块', async () => {
    const turnStateSuffix =
      '\n<EDITOR_STATE file_uuid="f" file_path="/a.mindlane" file_title="t">\n<SELECTED_NODES count="1">\n  <node id="n1" type="text" label="旧节点"/>\n</SELECTED_NODES>\n</EDITOR_STATE>'
    const mockProvider = createMockProvider('{"disciplines": []}')
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

  it('extractAndPersist works without filePath (skips tag update)', async () => {
    const mockResponse = JSON.stringify({
      disciplines: [
        {
          name: 'engineering',
          patterns: [
            { subTag: 'modular', description: '用户偏好模块化', observation: '倾向组件化设计' },
          ],
        },
      ],
    })
    const mockProvider = createMockProvider(mockResponse)

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('拆模块')],
      editlogEntries: [],
    })

    expect(await manager.loadIndex()).toContain('engineering-modular')
  })

  it('parseExtractionResponse handles markdown code blocks', async () => {
    const extractor = new MemoryExtractor(manager)

    const mockProvider = createMockProvider(
      '```json\n{"disciplines": [{"name": "engineering", "patterns": [{"subTag": "mvp", "description": "先跑MVP", "observation": "用户偏好快速验证"}]}]}\n```',
    )

    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('先做个最小版本试试')],
      editlogEntries: [],
    })

    const index = await manager.loadIndex()
    expect(index).toContain('engineering-mvp')
  })

  it('parseExtractionResponse skips unknown disciplines', async () => {
    const extractor = new MemoryExtractor(manager)

    const mockProvider = createMockProvider(
      '{"disciplines": [{"name": "alchemy", "patterns": [{"subTag": "gold", "description": "点金", "observation": "点石成金"}]}]}',
    )

    await extractor.extractAndPersist({
      provider: mockProvider as unknown as LLMProvider,
      messages: [new HumanMessage('点石成金')],
      editlogEntries: [],
    })

    expect(await manager.loadIndex()).toBe('')
  })
})
