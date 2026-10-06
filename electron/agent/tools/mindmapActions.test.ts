import { describe, it, expect, vi } from 'vitest'
import { createMindmapActionTools, type MindmapWriteProxy } from './mindmapActions.js'

/** Fake renderer client: records forwarded args and, by default, acks with `{ok: true, action, data}` as-is. */
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

describe('createMindmapActionTools (fixed 4 write tools)', () => {
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

describe('insertXmlFragment (renderer proxy)', () => {
  it('forwards args to the write channel and returns the renderer ack as-is', async () => {
    const { tools: t, proxy } = fakeProxy()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="text" content="branch"><node type="text" content="child" /></node>`,
      parentId: 'n1',
      position: 'child',
    })

    expect(proxy).toHaveBeenCalledTimes(1)
    expect(proxy).toHaveBeenCalledWith('file-a', 'insertXmlFragment', {
      xml: `<node type="text" content="branch"><node type="text" content="child" /></node>`,
      parentId: 'n1',
      position: 'child',
    })
    // The renderer ack is returned as-is as the tool result (model-facing contract: {ok, action, data})
    expect(result).toEqual({
      ok: true,
      action: 'insertXmlFragment',
      data: {
        xml: `<node type="text" content="branch"><node type="text" content="child" /></node>`,
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

describe('updateMindmapNode (renderer proxy)', () => {
  it('forwards xml to the update action', async () => {
    const { tools: t, proxy } = fakeProxy()
    const result = await t.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="n1" type="text" content="new content" />`,
    })

    expect(proxy).toHaveBeenCalledWith('file-a', 'updateMindmapNode', {
      xml: `<node id="n1" type="text" content="new content" />`,
    })
    expect(result).toEqual({
      ok: true,
      action: 'updateMindmapNode',
      data: { xml: `<node id="n1" type="text" content="new content" />` },
    })
  })
})

describe('moveMindmapNode (renderer proxy)', () => {
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

describe('deleteMindmapNode (renderer proxy)', () => {
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

describe('renderer unresponsive / ok:false / window unavailable (tool failure paths)', () => {
  it('returns the renderer error as a tool failure result with the long-content correction', async () => {
    const { tools: t } = fakeProxy({
      fail: '[block_not_found] Node "ghost" not found. Recovery: call readMindmap to re-locate it, then retry',
    })
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: '<node type="text" content="x" />',
    })
    const failure = result as { ok: boolean; error: string }
    expect(failure.ok).toBe(false)
    expect(failure.error).toContain(
      '[block_not_found] Node "ghost" not found. Recovery: call readMindmap to re-locate it, then retry',
    )
    // ADR-0023: the correction path when the criterion is misjudged (long content written by hand).
    expect(failure.error).toContain('generateMindmapFragment')
  })

  it('appends the long-content correction to a renderer ok:false ack', async () => {
    const proxy = vi.fn<MindmapWriteProxy>(async () => ({
      ok: false,
      error:
        '[xml_parse_error] The tag on line 1 is not closed. Recovery: rewrite the XML and retry',
    }))
    const tools = createMindmapActionTools(proxy)
    const result = await tools.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: '<node type="text" content="x" />',
    })
    const failure = result as { ok: boolean; error: string }
    expect(failure.ok).toBe(false)
    expect(failure.error).toContain('generateMindmapFragment')
    expect(failure.error).toContain('rewrite the XML and retry')
  })

  it('does not add the correction to the other write tools', async () => {
    const proxy = vi.fn<MindmapWriteProxy>(async () => ({
      ok: false,
      error:
        '[block_not_found] Node "ghost" not found. Recovery: call readMindmap to re-locate it, then retry',
    }))
    const tools = createMindmapActionTools(proxy)
    const result = await tools.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: '<node id="ghost" type="text" content="x" />',
    })
    expect(result).toEqual({
      ok: false,
      error:
        '[block_not_found] Node "ghost" not found. Recovery: call readMindmap to re-locate it, then retry',
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
    const failure = result as { ok: boolean; error: string }
    expect(failure.ok).toBe(false)
    expect(failure.error).toContain('boom')
    expect(failure.error).toContain('generateMindmapFragment')
  })
})
