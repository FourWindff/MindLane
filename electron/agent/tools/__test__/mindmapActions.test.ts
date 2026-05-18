import { describe, it, expect } from 'vitest'
import { createMindmapActionTools } from '../mindmapActions.js'

describe('createMindmapActionTools', () => {
  it('should include addPalaceNodeTool when hasPalace is true', () => {
    const tools = createMindmapActionTools(true)
    expect(tools.addPalaceNodeTool).toBeDefined()
  })

  it('should exclude addPalaceNodeTool when hasPalace is false', () => {
    const tools = createMindmapActionTools(false)
    expect(tools.addPalaceNodeTool).toBeUndefined()
    expect(tools.addTextNodeTool).toBeDefined()
    expect(tools.updateNodeTool).toBeDefined()
    expect(tools.deleteNodeTool).toBeDefined()
    expect(tools.batchAddNodesTool).toBeDefined()
  })
})

describe('batchAddMindmapNodes', () => {
  const tools = createMindmapActionTools(true)

  it('should accept yamlFragment and parentId', async () => {
    const yaml = `
- "子主题 A":
  - "子主题 A1"
  - "子主题 A2"
- "子主题 B"
`
    const result = await tools.batchAddNodesTool.invoke({
      yamlFragment: yaml,
      parentId: 'node-123',
    })

    expect(result).toMatchObject({
      ok: true,
      action: 'batchAddNodes',
      data: {
        yamlFragment: yaml.trim(),
        parentId: 'node-123',
      },
    })
  })

  it('should reject empty yamlFragment', async () => {
    const result = await tools.batchAddNodesTool.invoke({
      yamlFragment: '',
      parentId: 'node-123',
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'YAML 片段不能为空',
    })
  })

  it('should work without parentId (defaults to root)', async () => {
    const result = await tools.batchAddNodesTool.invoke({
      yamlFragment: '- "主题"',
    })

    expect(result).toMatchObject({
      ok: true,
      action: 'batchAddNodes',
    })
    expect(result.data.parentId).toBeUndefined()
  })
})
