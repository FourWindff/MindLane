import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, loadMemoryContext, type SystemPromptInput } from './context'
import { MemoryManager } from '../../memory/memoryManager'
import type { ChatContext } from '../../../ipc.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function tmpMemoryDir(): string {
  return path.join(os.tmpdir(), `ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

async function withMemoryManager(dir: string): Promise<MemoryManager> {
  const mm = new MemoryManager(dir)
  await mm.writeMemory('The user prefers modular design\nThe user prefers timeline narratives')
  return mm
}

const ctx: ChatContext = {
  fileUuid: 'file-1',
  filePath: '/t.mindlane',
  fileTitle: 't',
}

const baseInput: SystemPromptInput = {
  context: ctx,
}

describe('buildSystemPrompt memory', () => {
  it('loads memory via manager and injects MEMORY content', async () => {
    const dir = tmpMemoryDir()
    const mm = await withMemoryManager(dir)
    try {
      const prompt = await buildSystemPrompt({ ...baseInput, memoryManager: mm })
      expect(prompt).toContain('<MEMORY>')
      expect(prompt).toContain('The user prefers modular design')
      expect(prompt).toContain('The user prefers timeline narratives')
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
      expect(withPreload).toContain('The user prefers modular design')
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
      lastSummary: 'The user wants to build an AI assistant project',
    })
    expect(prompt).toContain('## History Summary')
    expect(prompt).toContain('The user wants to build an AI assistant project')
    expect(prompt).toContain('</SYSTEM_PROMPT>')
  })

  it('builds all sections in fixed order', async () => {
    const prompt = await buildSystemPrompt({
      ...baseInput,
      context: {
        ...ctx,
        selectedNodes: [{ id: 'n1', type: 'text', label: 'Node one' }],
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
        selectedNodes: [{ id: 'n1', type: 'text', label: 'Node one' }],
      },
    })

    // Selected nodes, the mindmap tree, attachments, and the MINDMAP shell never enter the system prompt.
    expect(prompt).not.toContain('<MINDMAP')
    expect(prompt).not.toContain('<SELECTED_NODES')
    expect(prompt).not.toContain('mindmapSummary')
    expect(prompt).not.toContain('getContextSummary')
    expect(prompt).not.toContain('Node one')
  })

  it('injects the node type registry into the XML contract (stable prefix)', async () => {
    const prompt = await buildSystemPrompt(baseInput)
    expect(prompt).toContain('<MINDLANE_XML_CONTRACT>')
    expect(prompt).toContain('### Node Type Registry')
    expect(prompt).toContain('text (Text node)')
    expect(prompt).toContain('image (Image node)')
    expect(prompt).toContain('palace (Memory palace node)')
    expect(prompt).toContain('block_not_found')
    expect(prompt).not.toContain('batchAddMindmapNodes')
    expect(prompt).not.toContain('addPalaceNode')
  })

  it('is byte-identical across turns when memory and summary are unchanged', async () => {
    const promptA = await buildSystemPrompt({
      ...baseInput,
      context: { ...ctx, selectedNodes: [{ id: 'n1', type: 'text', label: 'Node one' }] },
    })
    const promptB = await buildSystemPrompt({
      ...baseInput,
      context: { ...ctx, selectedNodes: [{ id: 'n2', type: 'text', label: 'Another node' }] },
    })

    // Volatile editor state (selected-node changes) does not affect the system prompt.
    expect(promptB).toBe(promptA)
  })
})
