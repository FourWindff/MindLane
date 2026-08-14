import { describe, expect, it, vi } from 'vitest'
import { createGetMindmapContextTool } from '../mindmapRead.js'

describe('createGetMindmapContextTool', () => {
  it('returns the injected provider output verbatim', async () => {
    const provider = vi.fn(async (fileUuid: string) => `live tree of ${fileUuid}`)
    const tool = createGetMindmapContextTool(provider)

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({ ok: true, summary: 'live tree of file-a' })
    expect(provider).toHaveBeenCalledWith('file-a')
  })

  it('surfaces a provider error as a clear tool error', async () => {
    const tool = createGetMindmapContextTool(async () => {
      throw new Error('编辑器不可用（窗口已关闭），无法读取导图')
    })

    const result = await tool.invoke({ fileUuid: 'file-a' })

    expect(result).toEqual({
      ok: false,
      error: '编辑器不可用（窗口已关闭），无法读取导图',
    })
  })

  it('surfaces a provider timeout rejection as a clear tool error', async () => {
    const tool = createGetMindmapContextTool(async () => {
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
    const tool = createGetMindmapContextTool(provider)

    await tool.invoke({})

    expect(provider).toHaveBeenCalledWith('')
  })

  it('documents the in-flight-writes semantic limit in the description', () => {
    const tool = createGetMindmapContextTool(async () => 'tree')
    const description = (tool as unknown as { description: string }).description

    // 引导模型如何取 fileUuid，并注明「本轮在途写入不可见」的限制。
    expect(description).toContain('file_uuid')
    expect(description).toContain('流结束时才落图')
    expect(description).toContain('不含')
  })
})
