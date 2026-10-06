import { describe, expect, it, vi } from 'vitest'
import { createReadMindmapTool } from './mindmapRead.js'

describe('createReadMindmapTool', () => {
  it('returns the injected provider output verbatim', async () => {
    const provider = vi.fn(async () => `live tree`)
    const tool = createReadMindmapTool(provider)

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({ ok: true, summary: 'live tree' })
    expect(provider).toHaveBeenCalledWith('file-a', { scope: 'whole' })
  })

  it('forwards tree-query parameters to the provider', async () => {
    const provider = vi.fn(async () => 'tree')
    const tool = createReadMindmapTool(provider)

    await tool.invoke({
      fileUuid: 'file-a',
      scope: 'subtree',
      subtreeId: 'n1',
      type: 'text',
      textContains: 'guide',
      maxDepth: 2,
    })

    expect(provider).toHaveBeenCalledWith('file-a', {
      scope: 'subtree',
      subtreeId: 'n1',
      type: 'text',
      textContains: 'guide',
      maxDepth: 2,
    })
  })

  it('omits empty query fields', async () => {
    const provider = vi.fn(async () => 'tree')
    const tool = createReadMindmapTool(provider)

    await tool.invoke({ fileUuid: 'file-a', type: '' })

    expect(provider).toHaveBeenCalledWith('file-a', { scope: 'whole' })
  })

  it('surfaces a provider error as a clear tool error', async () => {
    const tool = createReadMindmapTool(async () => {
      throw new Error('Editor is unavailable (the window is closed); cannot read mindmap')
    })

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({
      ok: false,
      error: 'Editor is unavailable (the window is closed); cannot read mindmap',
    })
  })

  it('surfaces a provider timeout rejection as a clear tool error', async () => {
    const tool = createReadMindmapTool(async () => {
      throw new Error('Read mindmap timed out (no response from the renderer within 3s)')
    })

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({
      ok: false,
      error: 'Read mindmap timed out (no response from the renderer within 3s)',
    })
  })

  it('passes an empty fileUuid through when the model omits the argument', async () => {
    const provider = vi.fn(async () => 'tree')
    const tool = createReadMindmapTool(provider)

    await tool.invoke({})

    expect(provider).toHaveBeenCalledWith('', { scope: 'whole' })
  })

  it('documents the live-apply semantic in the description', () => {
    const tool = createReadMindmapTool(async () => 'tree')
    const description = (tool as unknown as { description: string }).description

    // Guides the model on how to obtain fileUuid and states the "write tools land as soon as they execute" semantics.
    expect(description).toContain('file_uuid')
    expect(description).toContain('land as soon as they execute')
    expect(description).toContain('recovery strategy')
  })
})
