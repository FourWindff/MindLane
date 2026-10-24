import { describe, it, expect, vi } from 'vitest'
import { createMindmapActionTools } from './mindmapActions.js'
import type { MindmapWrite } from '../../../contracts/mindmapDocument/writeAction.js'

/** Fake local write executor: records the call and, by default, acks with `{ok: true, action, data}`. */
function fakeWrite(overrides: { fail?: string } = {}): {
  tools: ReturnType<typeof createMindmapActionTools>
  write: ReturnType<typeof vi.fn<MindmapWrite>>
} {
  const write = vi.fn<MindmapWrite>(async (_fileUuid, action, args) => {
    if (overrides.fail) {
      throw new Error(overrides.fail)
    }
    return { ok: true, action, data: args }
  })
  return { tools: createMindmapActionTools(write), write }
}

describe('createMindmapActionTools (fixed 4 write tools)', () => {
  it('registers exactly the 4 write tools', () => {
    const { tools: t } = fakeWrite()
    expect(Object.keys(t).sort()).toEqual([
      'deleteNodeTool',
      'insertXmlFragmentTool',
      'moveNodeTool',
      'updateNodeTool',
    ])
  })
})

describe('insertXmlFragment (local write)', () => {
  it('calls the local write executor and returns its ack as-is', async () => {
    const { tools: t, write } = fakeWrite()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="text" content="branch"><node type="text" content="child" /></node>`,
      targetId: 'n1',
      position: 'child',
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('file-a', 'insertXmlFragment', {
      xml: `<node type="text" content="branch"><node type="text" content="child" /></node>`,
      targetId: 'n1',
      position: 'child',
    })
    // The document write ack is returned as-is as the tool result (model-facing contract: {ok, action, data})
    expect(result).toEqual({
      ok: true,
      action: 'insertXmlFragment',
      data: {
        xml: `<node type="text" content="branch"><node type="text" content="child" /></node>`,
        targetId: 'n1',
        position: 'child',
      },
    })
  })

  it('forwards an empty fileUuid when absent', async () => {
    const { tools: t, write } = fakeWrite()
    await t.insertXmlFragmentTool.invoke({ xml: '<node type="text" content="x" />' })
    expect(write).toHaveBeenCalledWith('', 'insertXmlFragment', expect.anything())
  })
})

describe('updateMindmapNode (local write)', () => {
  it('forwards xml to the update action', async () => {
    const { tools: t, write } = fakeWrite()
    const result = await t.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="n1" type="text" content="new content" />`,
    })

    expect(write).toHaveBeenCalledWith('file-a', 'updateMindmapNode', {
      xml: `<node id="n1" type="text" content="new content" />`,
    })
    expect(result).toEqual({
      ok: true,
      action: 'updateMindmapNode',
      data: { xml: `<node id="n1" type="text" content="new content" />` },
    })
  })
})

describe('moveMindmapNode (local write)', () => {
  it('calls the move action with nodeId/targetId/position', async () => {
    const { tools: t, write } = fakeWrite()
    const result = await t.moveNodeTool.invoke({
      fileUuid: 'file-a',
      nodeId: 'n1',
      targetId: 'n2',
      position: 'after',
    })

    expect(write).toHaveBeenCalledWith('file-a', 'moveMindmapNode', {
      nodeId: 'n1',
      targetId: 'n2',
      position: 'after',
    })
    expect(result).toMatchObject({ ok: true, action: 'moveMindmapNode' })
  })
})

describe('deleteMindmapNode (local write)', () => {
  it('calls the deleteMindmapNode action', async () => {
    const { tools: t, write } = fakeWrite()
    const result = await t.deleteNodeTool.invoke({
      fileUuid: 'file-a',
      nodeId: 'n1',
      confirmDeleteSubtree: true,
    })

    expect(write).toHaveBeenCalledWith('file-a', 'deleteMindmapNode', {
      nodeId: 'n1',
      confirmDeleteSubtree: true,
    })
    expect(result).toMatchObject({ ok: true, action: 'deleteMindmapNode' })
  })
})

describe('landing failure / ok:false / unexpected executor error (tool failure paths)', () => {
  it('returns the landing error as a tool failure result with the long-content correction', async () => {
    const { tools: t } = fakeWrite({
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

  it('appends the long-content correction to an ok:false ack', async () => {
    const proxy = vi.fn<MindmapWrite>(async () => ({
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
    const proxy = vi.fn<MindmapWrite>(async () => ({
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
    const proxy = vi.fn<MindmapWrite>(async () => {
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
