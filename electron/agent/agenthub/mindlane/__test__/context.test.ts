import { describe, it, expect } from 'vitest'
import { ContextBuilder } from '../context'
import { MemoryManager } from '../../../memory/memoryManager'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('ContextBuilder memory', () => {
  it('injects memory index and relevant memories', async () => {
    const dir = path.join(os.tmpdir(), `ctx-${Date.now()}`)
    await fs.promises.mkdir(dir, { recursive: true })
    const mm = new MemoryManager(dir)
    await mm.writeMemory('eng-mod', '用户偏好模块化', 'eng content')
    await mm.writeMemory('hum-tl', '用户偏好时间轴', 'hum content')

    const builder = new ContextBuilder()
    builder.withMemory(mm)
    builder.withContext({
      fileUuid: 'file-1',
      fileTags: ['eng'],
      hasDocumentOpen: true,
      filePath: '/t.mindlane',
      fileTitle: 't',
    })
    builder.buildSystemPrompt()
    await builder.buildMemoryContext()
    builder.buildEnvironmentPrompt()
    const prompt = builder.build()

    expect(prompt).toContain('USER_MEMORY_INDEX')
    expect(prompt).toContain('eng-mod')
    expect(prompt).toContain('RELEVANT_MEMORIES')
    expect(prompt).toContain('eng content')
    expect(prompt).not.toContain('hum content')

    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  it('injects last summary into system prompt', () => {
    const builder = new ContextBuilder()
    builder.withLastSummary('用户想做一个 AI 助手项目')
    builder.buildSystemPrompt()
    const prompt = builder.build()

    expect(prompt).toContain('历史摘要')
    expect(prompt).toContain('用户想做一个 AI 助手项目')
    expect(prompt).toContain('</SYSTEM_PROMPT>')
  })
})
