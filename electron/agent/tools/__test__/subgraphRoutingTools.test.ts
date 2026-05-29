import { describe, expect, it } from 'vitest'
import {
  createGenerateMindmapFragmentTool,
  createGeneratePalaceTool,
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
  isVirtualSubgraphTool,
} from '../subgraphRoutingTools.js'

describe('subgraph routing tools', () => {
  it('creates generateMindmapFragment virtual tool', () => {
    const tool = createGenerateMindmapFragmentTool()
    const schema = tool.schema as unknown as { parse: (v: unknown) => unknown }

    expect(tool.name).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
    expect(schema.parse({
      source: { type: 'pdf', path: '/test.pdf' },
      title: 'PDF 导图',
    })).toEqual({
      source: { type: 'pdf', path: '/test.pdf' },
      title: 'PDF 导图',
    })
  })

  it('creates generatePalace virtual tool', () => {
    const tool = createGeneratePalaceTool()
    const schema = tool.schema as unknown as { parse: (v: unknown) => unknown }

    expect(tool.name).toBe(GENERATE_PALACE_TOOL)
    expect(schema.parse({
      inputText: '记忆内容',
      inputNodes: [{ id: 'n1', label: '节点1' }],
    })).toEqual({
      inputText: '记忆内容',
      inputNodes: [{ id: 'n1', label: '节点1' }],
    })
  })

  it('recognizes virtual subgraph tools', () => {
    expect(isVirtualSubgraphTool(GENERATE_MINDMAP_FRAGMENT_TOOL)).toBe(true)
    expect(isVirtualSubgraphTool(GENERATE_PALACE_TOOL)).toBe(true)
    expect(isVirtualSubgraphTool('batchAddMindmapNodes')).toBe(false)
  })
})
