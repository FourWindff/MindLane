import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MemoryExtractor } from '../memoryExtractor.js'
import { MemoryManager } from '../memoryManager.js'

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
    }], tempDir)

    const index = await manager.loadIndex()
    expect(index).toContain('engineering-modular')

    const content = await fs.promises.readFile(path.join(tempDir, 'mindlanememory', 'engineering-modular.md'), 'utf-8')
    expect(content).toContain('倾向组件化设计')
  })
})
