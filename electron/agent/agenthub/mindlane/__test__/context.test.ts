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
  await mm.writeMemory('用户偏好模块化设计\n用户偏好时间轴叙事')
  return mm
}

const ctx: ChatContext = {
  fileUuid: 'file-1',
  hasDocumentOpen: true,
  filePath: '/t.mindlane',
  fileTitle: 't',
}

const baseInput: SystemPromptInput = {
  context: ctx,
  capabilityFlags: { hasPalace: true },
}

describe('buildSystemPrompt memory', () => {
  it('loads memory via manager and injects MEMORY content', async () => {
    const dir = tmpMemoryDir()
    const mm = await withMemoryManager(dir)
    try {
      const prompt = await buildSystemPrompt({ ...baseInput, memoryManager: mm })
      expect(prompt).toContain('<MEMORY>')
      expect(prompt).toContain('用户偏好模块化设计')
      expect(prompt).toContain('用户偏好时间轴叙事')
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  it('preloaded memory equals fresh-load output and works without a manager', async () => {
    const dir = tmpMemoryDir()
    const mm = await withMemoryManager(dir)
    try {
      const preloaded = await loadMemoryContext(mm)
      expect(preloaded).toBeDefined()

      const fresh = await buildSystemPrompt({ ...baseInput, memoryManager: mm })
      const withPreload = await buildSystemPrompt({ ...baseInput, memory: preloaded })

      expect(withPreload).toBe(fresh)
      expect(withPreload).toContain('<MEMORY>')
      expect(withPreload).toContain('用户偏好模块化设计')
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  it('omits the memory section when neither manager nor preload is given', async () => {
    const prompt = await buildSystemPrompt({ ...baseInput })
    expect(prompt).not.toContain('<MEMORY>')
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
        selectedNodes: [{ id: 'n1', type: 'text', label: '节点一' }],
      },
    })

    expect(prompt).toContain('<SYSTEM_PROMPT>')
    expect(prompt).toContain('<ENV>')

    const iSystem = prompt.indexOf('<SYSTEM_PROMPT>')
    const iEnv = prompt.indexOf('<ENV>')
    expect(iSystem).toBeGreaterThanOrEqual(0)
    expect(iSystem).toBeLessThan(iEnv)
  })

  it('omits the mindmap context section entirely (byte-stable prefix)', async () => {
    const prompt = await buildSystemPrompt({
      ...baseInput,
      context: {
        ...ctx,
        hasDocumentOpen: true,
        selectedNodes: [{ id: 'n1', type: 'text', label: '节点一' }],
      },
    })

    // 选中节点、导图树、附件、MINDMAP 外壳都不进 system prompt。
    expect(prompt).not.toContain('<MINDMAP')
    expect(prompt).not.toContain('<SELECTED_NODES')
    expect(prompt).not.toContain('mindmapSummary')
    expect(prompt).not.toContain('getContextSummary')
    expect(prompt).not.toContain('节点一')
  })

  it('injects the node type registry into the XML contract (stable prefix)', async () => {
    const prompt = await buildSystemPrompt(baseInput)
    expect(prompt).toContain('<MINDLANE_XML_CONTRACT>')
    expect(prompt).toContain('### 节点类型注册表')
    expect(prompt).toContain('text（文本节点）')
    expect(prompt).toContain('image（图片节点）')
    expect(prompt).toContain('palace（记忆宫殿节点）')
    expect(prompt).toContain('block_not_found')
    expect(prompt).not.toContain('batchAddMindmapNodes')
    expect(prompt).not.toContain('addPalaceNode')
  })

  it('is byte-identical across turns when memory and summary are unchanged', async () => {
    const promptA = await buildSystemPrompt({
      ...baseInput,
      context: { ...ctx, selectedNodes: [{ id: 'n1', type: 'text', label: '节点一' }] },
    })
    const promptB = await buildSystemPrompt({
      ...baseInput,
      context: { ...ctx, selectedNodes: [{ id: 'n2', type: 'text', label: '另一个节点' }] },
    })

    // 易变编辑器状态（选中节点变化）不影响 system prompt。
    expect(promptB).toBe(promptA)
  })
})
