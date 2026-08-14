import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, loadMemoryContext, type SystemPromptInput } from '../context'
import { MemoryManager } from '../../../memory/memoryManager'
import type { ChatContext } from '../../../../ipc.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function tmpMemoryDir(): string {
  return path.join(os.tmpdir(), `ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

async function withMemoryManager(dir: string): Promise<MemoryManager> {
  const mm = new MemoryManager(dir)
  await mm.writeMemory('eng-mod', '用户偏好模块化', 'eng content')
  await mm.writeMemory('hum-tl', '用户偏好时间轴', 'hum content')
  return mm
}

const ctx: ChatContext = {
  fileUuid: 'file-1',
  fileTags: ['eng'],
  hasDocumentOpen: true,
  filePath: '/t.mindlane',
  fileTitle: 't',
}

const baseInput: SystemPromptInput = {
  context: ctx,
  capabilityFlags: { hasPalace: true },
}

describe('buildSystemPrompt memory', () => {
  it('loads memory via manager and injects index + relevant memories', async () => {
    const dir = tmpMemoryDir()
    const mm = await withMemoryManager(dir)
    try {
      const prompt = await buildSystemPrompt({ ...baseInput, memoryManager: mm })
      expect(prompt).toContain('USER_MEMORY_INDEX')
      expect(prompt).toContain('eng-mod')
      expect(prompt).toContain('RELEVANT_MEMORIES')
      expect(prompt).toContain('eng content')
      expect(prompt).not.toContain('hum content')
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  it('preloaded memory equals fresh-load output and works without a manager', async () => {
    const dir = tmpMemoryDir()
    const mm = await withMemoryManager(dir)
    try {
      const preloaded = await loadMemoryContext(baseInput.context, mm)
      expect(preloaded).toBeDefined()

      const fresh = await buildSystemPrompt({ ...baseInput, memoryManager: mm })
      const withPreload = await buildSystemPrompt({ ...baseInput, memory: preloaded })

      expect(withPreload).toBe(fresh)
      expect(withPreload).toContain('USER_MEMORY_INDEX')
      expect(withPreload).toContain('eng content')
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  it('omits memory sections when neither manager nor preload is given', async () => {
    const prompt = await buildSystemPrompt({ ...baseInput })
    expect(prompt).not.toContain('USER_MEMORY_INDEX')
    expect(prompt).not.toContain('RELEVANT_MEMORIES')
  })
})

describe('buildSystemPrompt sections', () => {
  it('injects last summary into system prompt', async () => {
    const prompt = await buildSystemPrompt({
      ...baseInput,
      lastSummary: '用户想做一个 AI 助手项目',
    })
    expect(prompt).toContain('历史摘要')
    expect(prompt).toContain('用户想做一个 AI 助手项目')
    expect(prompt).toContain('</SYSTEM_PROMPT>')
  })

  it('builds all sections in fixed order', async () => {
    const prompt = await buildSystemPrompt({
      ...baseInput,
      context: {
        ...ctx,
        mindmapSummary: '核心概念：AI',
        selectedNodes: [{ id: 'n1', type: 'text', label: '节点一' }],
      },
    })

    expect(prompt).toContain('<SYSTEM_PROMPT>')
    expect(prompt).toContain('<ENV>')
    expect(prompt).toContain('<MINDMAP')
    expect(prompt).toContain('<SELECTED_NODES')
    expect(prompt).toContain('</MINDMAP>')

    const iSystem = prompt.indexOf('<SYSTEM_PROMPT>')
    const iEnv = prompt.indexOf('<ENV>')
    const iMindmap = prompt.indexOf('<MINDMAP')
    expect(iSystem).toBeGreaterThanOrEqual(0)
    expect(iSystem).toBeLessThan(iEnv)
    expect(iEnv).toBeLessThan(iMindmap)
  })
})
