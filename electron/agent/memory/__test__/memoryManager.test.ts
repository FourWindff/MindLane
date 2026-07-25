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

  it('loadIndex returns empty when no index', async () => {
    expect(await manager.loadIndex()).toBe('')
  })

  it('writeMemory creates file and rebuilds index', async () => {
    await manager.writeMemory('eng-mod', '用户偏好模块化', '倾向组件化')
    expect(await manager.loadIndex()).toContain('eng-mod')
    const content = await fs.promises.readFile(
      path.join(tempDir, 'mindlanememory', 'eng-mod.md'),
      'utf-8',
    )
    expect(content).toContain('tag: eng-mod')
    expect(content).toContain('倾向组件化')
  })

  it('writeMemory appends to existing file', async () => {
    await manager.writeMemory('eng-mod', 'desc', '第一次')
    await manager.writeMemory('eng-mod', 'desc', '第二次')
    const content = await fs.promises.readFile(
      path.join(tempDir, 'mindlanememory', 'eng-mod.md'),
      'utf-8',
    )
    expect(content).toContain('第一次')
    expect(content).toContain('第二次')
  })

  it('loadMemoriesForTags filters by prefix', async () => {
    await manager.writeMemory('eng-mod', 'd1', 'eng')
    await manager.writeMemory('hum-tl', 'd2', 'hum')
    expect(await manager.loadMemoriesForTags(['eng'])).toHaveLength(1)
    expect((await manager.loadMemoriesForTags(['eng', 'hum'])).length).toBe(2)
  })

  it('listTags returns all memory tags', async () => {
    await manager.writeMemory('eng-mod', 'd1', 'c1')
    await manager.writeMemory('hum-tl', 'd2', 'c2')
    expect((await manager.listTags()).sort()).toEqual(['eng-mod', 'hum-tl'])
  })
})
