import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MemoryManager } from './memoryManager.js'

describe('MemoryManager', () => {
  let tempDir: string
  let manager: MemoryManager

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `ml-mem-${Date.now()}`)
    await fs.promises.mkdir(tempDir, { recursive: true })
    manager = new MemoryManager(tempDir)
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('loadMemory returns empty when MEMORY.md missing', async () => {
    expect(await manager.loadMemory()).toBe('')
  })

  it('writeMemory creates MEMORY.md', async () => {
    await manager.writeMemory('The user prefers modularity')
    expect(await manager.loadMemory()).toBe('The user prefers modularity\n')
    const content = await fs.promises.readFile(
      path.join(tempDir, 'mindlanememory', 'MEMORY.md'),
      'utf-8',
    )
    expect(content).toBe('The user prefers modularity\n')
  })

  it('writeMemory overwrites the full file', async () => {
    await manager.writeMemory('Fact one\nFact two')
    await manager.writeMemory('Fact one\nMerged fact')
    expect(await manager.loadMemory()).toBe('Fact one\nMerged fact\n')
  })
})
