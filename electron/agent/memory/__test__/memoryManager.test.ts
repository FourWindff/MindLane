import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MemoryManager } from '../memoryManager.js'

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
    await manager.writeMemory('用户偏好模块化')
    expect(await manager.loadMemory()).toBe('用户偏好模块化\n')
    const content = await fs.promises.readFile(
      path.join(tempDir, 'mindlanememory', 'MEMORY.md'),
      'utf-8',
    )
    expect(content).toBe('用户偏好模块化\n')
  })

  it('writeMemory overwrites the full file', async () => {
    await manager.writeMemory('事实一\n事实二')
    await manager.writeMemory('事实一\n合并后的事实')
    expect(await manager.loadMemory()).toBe('事实一\n合并后的事实\n')
  })
})
