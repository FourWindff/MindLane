import { describe, expect, it, vi } from 'vitest'
import { createReadMindmapTool } from './mindmapRead.js'

describe('createReadMindmapTool', () => {
  it('returns the injected document reader output verbatim', async () => {
    const reader = vi.fn(() => `live tree`)
    const tool = createReadMindmapTool(reader)

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({ ok: true, summary: 'live tree' })
    expect(reader).toHaveBeenCalledWith('file-a', { scope: 'whole' })
  })

  it('forwards tree-query parameters to the reader', async () => {
    const reader = vi.fn(() => 'tree')
    const tool = createReadMindmapTool(reader)

    await tool.invoke({
      fileUuid: 'file-a',
      scope: 'subtree',
      subtreeId: 'n1',
      type: 'text',
      textContains: 'guide',
      maxDepth: 2,
    })

    expect(reader).toHaveBeenCalledWith('file-a', {
      scope: 'subtree',
      subtreeId: 'n1',
      type: 'text',
      textContains: 'guide',
      maxDepth: 2,
    })
  })

  it('omits empty query fields', async () => {
    const reader = vi.fn(() => 'tree')
    const tool = createReadMindmapTool(reader)

    await tool.invoke({ fileUuid: 'file-a', type: '' })

    expect(reader).toHaveBeenCalledWith('file-a', { scope: 'whole' })
  })

  it('surfaces a reader error as a clear tool error', async () => {
    const tool = createReadMindmapTool(() => {
      throw new Error('This file is not open, cannot read the mindmap')
    })

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({
      ok: false,
      error: 'This file is not open, cannot read the mindmap',
    })
  })

  it('passes an empty fileUuid through when the model omits the argument', async () => {
    const reader = vi.fn(() => 'tree')
    const tool = createReadMindmapTool(reader)

    await tool.invoke({})

    expect(reader).toHaveBeenCalledWith('', { scope: 'whole' })
  })

  it('documents the live-apply semantic in the description', () => {
    const tool = createReadMindmapTool(() => 'tree')
    const description = (tool as unknown as { description: string }).description

    // Guides the model on how to obtain fileUuid and states the "write tools land as soon as they execute" semantics.
    expect(description).toContain('file_uuid')
    expect(description).toContain('land as soon as they execute')
    expect(description).toContain('recovery strategy')
    // The data source is the main-process document, never the renderer or disk.
    expect(description).toContain('authoritative document held by the main process')
    expect(description).not.toContain('renderer')
  })
})
