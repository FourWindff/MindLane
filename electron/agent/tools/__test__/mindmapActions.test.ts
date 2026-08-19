import { describe, it, expect, vi } from 'vitest'
import { createMindmapActionTools, type MindmapWriteProxy } from '../mindmapActions.js'

/** 伪渲染层客户端：记录转发参数，默认回 `{ok: true, action, data}` 原样应答。 */
function fakeProxy(overrides: { fail?: string } = {}): {
  tools: ReturnType<typeof createMindmapActionTools>
  proxy: ReturnType<typeof vi.fn<MindmapWriteProxy>>
} {
  const proxy = vi.fn<MindmapWriteProxy>(async (_fileUuid, action, args) => {
    if (overrides.fail) {
      throw new Error(overrides.fail)
    }
    return { ok: true, action, data: args }
  })
  return { tools: createMindmapActionTools(proxy), proxy }
}

describe('createMindmapActionTools（固定 4 写工具）', () => {
  it('registers exactly the 4 write tools', () => {
    const { tools: t } = fakeProxy()
    expect(Object.keys(t).sort()).toEqual([
      'deleteNodeTool',
      'insertXmlFragmentTool',
      'moveNodeTool',
      'updateNodeTool',
    ])
  })
})

describe('insertXmlFragment（渲染层代理）', () => {
  it('forwards args to the write channel and returns the renderer ack as-is', async () => {
    const { tools: t, proxy } = fakeProxy()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="text" content="分支"><node type="text" content="子" /></node>`,
      parentId: 'n1',
      position: 'child',
    })

    expect(proxy).toHaveBeenCalledTimes(1)
    expect(proxy).toHaveBeenCalledWith('file-a', 'insertXmlFragment', {
      xml: `<node type="text" content="分支"><node type="text" content="子" /></node>`,
      parentId: 'n1',
      position: 'child',
    })
    // 渲染层应答原样作为工具结果（模型视角契约：{ok, action, data}）
    expect(result).toEqual({
      ok: true,
      action: 'insertXmlFragment',
      data: {
        xml: `<node type="text" content="分支"><node type="text" content="子" /></node>`,
        parentId: 'n1',
        position: 'child',
      },
    })
  })

  it('forwards an empty fileUuid when absent', async () => {
    const { tools: t, proxy } = fakeProxy()
    await t.insertXmlFragmentTool.invoke({ xml: '<node type="text" content="x" />' })
    expect(proxy).toHaveBeenCalledWith('', 'insertXmlFragment', expect.anything())
  })
})

describe('updateMindmapNode（渲染层代理）', () => {
  it('forwards xml to the update action', async () => {
    const { tools: t, proxy } = fakeProxy()
    const result = await t.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="n1" type="text" content="新内容" />`,
    })

    expect(proxy).toHaveBeenCalledWith('file-a', 'updateMindmapNode', {
      xml: `<node id="n1" type="text" content="新内容" />`,
    })
    expect(result).toEqual({
      ok: true,
      action: 'updateMindmapNode',
      data: { xml: `<node id="n1" type="text" content="新内容" />` },
    })
  })
})

describe('moveMindmapNode（渲染层代理）', () => {
  it('forwards nodeId/targetId/position to the move action', async () => {
    const { tools: t, proxy } = fakeProxy()
    const result = await t.moveNodeTool.invoke({
      fileUuid: 'file-a',
      nodeId: 'n1',
      targetId: 'n2',
      position: 'after',
    })

    expect(proxy).toHaveBeenCalledWith('file-a', 'moveMindmapNode', {
      nodeId: 'n1',
      targetId: 'n2',
      position: 'after',
    })
    expect(result).toMatchObject({ ok: true, action: 'moveMindmapNode' })
  })
})

describe('deleteMindmapNode（渲染层代理）', () => {
  it('forwards to the deleteNode action the renderer responder applies', async () => {
    const { tools: t, proxy } = fakeProxy()
    const result = await t.deleteNodeTool.invoke({
      fileUuid: 'file-a',
      nodeId: 'n1',
      confirmDeleteSubtree: true,
    })

    expect(proxy).toHaveBeenCalledWith('file-a', 'deleteNode', {
      nodeId: 'n1',
      confirmDeleteSubtree: true,
    })
    expect(result).toMatchObject({ ok: true, action: 'deleteNode' })
  })
})

describe('渲染层无响应 / ok:false / 窗口不可用（工具失败路径）', () => {
  it('returns the renderer error as a tool failure result', async () => {
    const { tools: t } = fakeProxy({
      fail: '[block_not_found] 节点「ghost」不存在。恢复策略：先调用 readMindmap 重新定位后再操作',
    })
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: '<node type="text" content="x" />',
    })
    expect(result).toEqual({
      ok: false,
      error: '[block_not_found] 节点「ghost」不存在。恢复策略：先调用 readMindmap 重新定位后再操作',
    })
  })

  it('converts non-Error rejections to a string error', async () => {
    const proxy = vi.fn<MindmapWriteProxy>(async () => {
      throw 'boom'
    })
    const tools = createMindmapActionTools(proxy)
    const result = await tools.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: '<node type="text" content="x" />',
    })
    expect(result).toEqual({ ok: false, error: 'boom' })
  })
})
