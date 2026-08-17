import { describe, expect, it, vi } from 'vitest'
import { createReadMindmapTool } from '../mindmapRead.js'

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
      textContains: '指南',
      maxDepth: 2,
    })

    expect(provider).toHaveBeenCalledWith('file-a', {
      scope: 'subtree',
      subtreeId: 'n1',
      type: 'text',
      textContains: '指南',
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
      throw new Error('编辑器不可用（窗口已关闭），无法读取导图')
    })

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({
      ok: false,
      error: '编辑器不可用（窗口已关闭），无法读取导图',
    })
  })

  it('surfaces a provider timeout rejection as a clear tool error', async () => {
    const tool = createReadMindmapTool(async () => {
      throw new Error('读取导图超时（3s 内未收到渲染层响应）')
    })

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({
      ok: false,
      error: '读取导图超时（3s 内未收到渲染层响应）',
    })
  })

  it('passes an empty fileUuid through when the model omits the argument', async () => {
    const provider = vi.fn(async () => 'tree')
    const tool = createReadMindmapTool(provider)

    await tool.invoke({})

    expect(provider).toHaveBeenCalledWith('', { scope: 'whole' })
  })

  it('documents the in-flight-writes semantic limit in the description', () => {
    const tool = createReadMindmapTool(async () => 'tree')
    const description = (tool as unknown as { description: string }).description

    // 引导模型如何取 fileUuid，并注明「本轮在途写入不可见」的限制。
    expect(description).toContain('file_uuid')
    expect(description).toContain('流结束时才落图')
    expect(description).toContain('不含')
  })
})
