import { describe, it, expect, vi } from 'vitest'
import { createMindmapActionTools, type EditorSnapshotProvider } from '../mindmapActions.js'
import type { MindmapEditorSnapshot } from '../../../ipc.js'

const SNAPSHOT: MindmapEditorSnapshot = {
  nodeIds: ['root', 'n1', 'n2'],
  assetIds: ['a1'],
  parents: { n1: 'root', n2: 'root' },
}

function tools(overrides: Partial<MindmapEditorSnapshot> = {}): {
  tools: ReturnType<typeof createMindmapActionTools>
  provider: ReturnType<typeof vi.fn<EditorSnapshotProvider>>
} {
  const provider = vi.fn<EditorSnapshotProvider>(async () => ({ ...SNAPSHOT, ...overrides }))
  return { tools: createMindmapActionTools(provider), provider }
}

describe('createMindmapActionTools（固定 4 写工具）', () => {
  it('registers exactly the 4 write tools', () => {
    const { tools: t } = tools()
    expect(Object.keys(t).sort()).toEqual([
      'deleteNodeTool',
      'insertXmlFragmentTool',
      'moveNodeTool',
      'updateNodeTool',
    ])
  })
})

describe('insertXmlFragment', () => {
  it('accepts a valid nested fragment and returns the action', async () => {
    const { tools: t, provider } = tools()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="text" content="分支"><node type="text" content="子" /></node>`,
      parentId: 'n1',
    })

    expect(result).toMatchObject({
      ok: true,
      action: 'insertXmlFragment',
      data: { parentId: 'n1', position: 'child', nodeCount: 2 },
    })
    expect(provider).toHaveBeenCalledWith('file-a')
  })

  it('returns xml_parse_error for malformed XML', async () => {
    const { tools: t } = tools()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="text" content="a"><node>`,
    })
    expect(result).toMatchObject({ ok: false })
    expect((result as { error: string }).error).toContain('xml_parse_error')
    expect((result as { error: string }).error).toContain('恢复策略')
  })

  it('returns text_unescaped for raw < in attribute values', async () => {
    const { tools: t } = tools()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="text" content="a<b" />`,
    })
    expect((result as { error: string }).error).toContain('text_unescaped')
  })

  it('returns invalid_type for unknown types', async () => {
    const { tools: t } = tools()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="video" content="x" />`,
    })
    expect((result as { error: string }).error).toContain('invalid_type')
  })

  it('returns tree_invalid when the fragment reuses an existing id', async () => {
    const { tools: t } = tools()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="n1" type="text" content="x" />`,
    })
    expect((result as { error: string }).error).toContain('tree_invalid')
  })

  it('returns asset_not_found for missing asset references', async () => {
    const { tools: t } = tools()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="image" asset="ghost" />`,
    })
    expect((result as { error: string }).error).toContain('asset_not_found')
  })

  it('accepts image nodes referencing existing assets', async () => {
    const { tools: t } = tools()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="image" asset="a1" alt="图" />`,
      parentId: 'n1',
    })
    expect(result).toMatchObject({ ok: true, action: 'insertXmlFragment' })
  })

  it('returns block_not_found for unknown parentId', async () => {
    const { tools: t } = tools()
    const result = await t.insertXmlFragmentTool.invoke({
      fileUuid: 'file-a',
      xml: `<node type="text" content="x" />`,
      parentId: 'ghost',
    })
    expect((result as { error: string }).error).toContain('block_not_found')
  })
})

describe('updateMindmapNode', () => {
  it('accepts a single-root XML replacing an existing node', async () => {
    const { tools: t } = tools()
    const result = await t.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="n1" type="text" content="新内容"><node type="text" content="新子" /></node>`,
    })
    expect(result).toMatchObject({
      ok: true,
      action: 'updateMindmapNode',
      data: { nodeId: 'n1', nodeCount: 2 },
    })
  })

  it('returns block_not_found for unknown ids', async () => {
    const { tools: t } = tools()
    const result = await t.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="ghost" type="text" content="x" />`,
    })
    expect((result as { error: string }).error).toContain('block_not_found')
  })

  it('refuses to replace root', async () => {
    const { tools: t } = tools()
    const result = await t.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="root" type="text" content="x" />`,
    })
    expect((result as { error: string }).error).toContain('tree_invalid')
  })

  it('rejects multi-root update XML', async () => {
    const { tools: t } = tools()
    const result = await t.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="n1" type="text" content="a" /><node type="text" content="b" />`,
    })
    expect((result as { error: string }).error).toContain('tree_invalid')
  })

  it('rejects subtree ids colliding with other nodes', async () => {
    const { tools: t } = tools()
    const result = await t.updateNodeTool.invoke({
      fileUuid: 'file-a',
      xml: `<node id="n1" type="text" content="a"><node id="n2" type="text" content="b" /></node>`,
    })
    expect((result as { error: string }).error).toContain('tree_invalid')
  })
})

describe('moveMindmapNode', () => {
  it('accepts child moves', async () => {
    const { tools: t } = tools()
    const result = await t.moveNodeTool.invoke({
      fileUuid: 'file-a',
      nodeId: 'n1',
      targetId: 'n2',
    })
    expect(result).toMatchObject({
      ok: true,
      action: 'moveMindmapNode',
      data: { nodeId: 'n1', targetId: 'n2', position: 'child' },
    })
  })

  it('refuses to move root', async () => {
    const { tools: t } = tools()
    const result = await t.moveNodeTool.invoke({ fileUuid: 'file-a', nodeId: 'root' })
    expect((result as { error: string }).error).toContain('tree_invalid')
  })

  it('returns block_not_found for unknown nodes', async () => {
    const { tools: t } = tools()
    const result = await t.moveNodeTool.invoke({
      fileUuid: 'file-a',
      nodeId: 'ghost',
      targetId: 'n2',
    })
    expect((result as { error: string }).error).toContain('block_not_found')
  })

  it('detects cycles via the parents chain', async () => {
    // n1 的子树包含 n2（parents: n2 → n1）
    const { tools: t } = tools({ parents: { n1: 'root', n2: 'n1' } })
    const result = await t.moveNodeTool.invoke({
      fileUuid: 'file-a',
      nodeId: 'n1',
      targetId: 'n2',
    })
    expect((result as { error: string }).error).toContain('tree_invalid')
    expect((result as { error: string }).error).toContain('环')
  })
})

describe('deleteMindmapNode', () => {
  it('accepts deletion of a subtree root', async () => {
    const { tools: t } = tools()
    const result = await t.deleteNodeTool.invoke({
      fileUuid: 'file-a',
      nodeId: 'n1',
    })
    expect(result).toMatchObject({ ok: true, action: 'deleteNode', data: { nodeId: 'n1' } })
  })

  it('refuses to delete root', async () => {
    const { tools: t } = tools()
    const result = await t.deleteNodeTool.invoke({ fileUuid: 'file-a', nodeId: 'root' })
    expect((result as { error: string }).error).toContain('tree_invalid')
  })
})
