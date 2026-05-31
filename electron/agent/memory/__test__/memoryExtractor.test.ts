import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MemoryExtractor } from '../memoryExtractor.js'
import { MemoryManager } from '../memoryManager.js'
import type { MindLaneFile } from '../../../../src/shared/lib/fileFormat.js'

// Minimal mock provider for testing
interface MockProvider {
  reasoningModel: {
    invoke: (messages: unknown[]) => Promise<{ content: string }>
  }
}

function createMockProvider(responseContent: string): MockProvider {
  return {
    reasoningModel: {
      invoke: vi.fn().mockResolvedValue({ content: responseContent }),
    },
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
    await extractor.persist([{
      discipline: 'engineering',
      subTag: 'modular',
      description: '用户偏好模块化',
      observation: '倾向组件化设计',
    }])

    const index = await manager.loadIndex()
    expect(index).toContain('engineering-modular')

    const content = await fs.promises.readFile(path.join(tempDir, 'mindlanememory', 'engineering-modular.md'), 'utf-8')
    expect(content).toContain('倾向组件化设计')
  })

  it('extractAndPersist calls LLM, persists patterns, and updates .mindlane tags', async () => {
    const mindlaneFile: MindLaneFile = {
      version: '1.0',
      metadata: { title: 'Test', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      mindmap: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      documents: [],
    }
    const mindlanePath = path.join(tempDir, 'test.mindlane')
    await fs.promises.writeFile(mindlanePath, JSON.stringify(mindlaneFile, null, 2), 'utf-8')

    const mockResponse = JSON.stringify({
      disciplines: [{
        name: 'engineering',
        patterns: [{
          subTag: 'modular',
          description: '用户偏好模块化',
          observation: '倾向组件化设计',
          evidence: ['我们把这个拆成几个模块'],
        }],
      }],
    })
    const mockProvider = createMockProvider(mockResponse)

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as any,
      messages: [
        { role: 'user', content: '我们把这个拆成几个模块来做' },
        { role: 'assistant', content: '好的，我来帮你设计模块结构' },
      ],
      mindmapSummary: '',
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
    const mindlaneFile: MindLaneFile = {
      version: '1.0',
      metadata: { title: 'Test', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      mindmap: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      documents: [],
    }
    const mindlanePath = path.join(tempDir, 'empty.mindlane')
    await fs.promises.writeFile(mindlanePath, JSON.stringify(mindlaneFile, null, 2), 'utf-8')

    const mockProvider = createMockProvider('{"disciplines": []}')

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as any,
      messages: [{ role: 'user', content: 'hello' }],
      mindmapSummary: '',
      filePath: mindlanePath,
    })

    // No memory file should be created
    const index = await manager.loadIndex()
    expect(index).toBe('')
  })

  it('extractAndPersist merges new discipline tags with existing ones', async () => {
    const mindlaneFile: MindLaneFile = {
      version: '1.0',
      metadata: { title: 'Test', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', tags: ['humanities'] },
      mindmap: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      documents: [],
    }
    const mindlanePath = path.join(tempDir, 'merge.mindlane')
    await fs.promises.writeFile(mindlanePath, JSON.stringify(mindlaneFile, null, 2), 'utf-8')

    const mockResponse = JSON.stringify({
      disciplines: [{
        name: 'engineering',
        patterns: [{
          subTag: 'modular',
          description: '用户偏好模块化',
          observation: '倾向组件化设计',
        }],
      }],
    })
    const mockProvider = createMockProvider(mockResponse)

    const extractor = new MemoryExtractor(manager)
    await extractor.extractAndPersist({
      provider: mockProvider as any,
      messages: [{ role: 'user', content: '拆模块' }],
      mindmapSummary: '',
      filePath: mindlanePath,
    })

    const updatedRaw = await fs.promises.readFile(mindlanePath, 'utf-8')
    const updated = JSON.parse(updatedRaw) as MindLaneFile
    expect(updated.metadata.tags).toContain('humanities')
    expect(updated.metadata.tags).toContain('engineering')
  })

  it('parseExtractionResponse handles markdown code blocks', async () => {
    const extractor = new MemoryExtractor(manager)

    const mockProvider = createMockProvider('```json\n{"disciplines": [{"name": "engineering", "patterns": [{"subTag": "mvp", "description": "先跑MVP", "observation": "用户偏好快速验证"}]}]}\n```')

    await extractor.extractAndPersist({
      provider: mockProvider as any,
      messages: [{ role: 'user', content: '先做个最小版本试试' }],
      mindmapSummary: '',
      filePath: path.join(tempDir, 'dummy.mindlane'),
    })

    const index = await manager.loadIndex()
    expect(index).toContain('engineering-mvp')
  })
})
