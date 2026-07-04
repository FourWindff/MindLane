import { describe, expect, it } from 'vitest'
import {
  createGenerateMindmapFragmentTool,
  createGeneratePalaceTool,
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
} from '../subgraphRoutingTools.js'

describe('subgraph routing tools', () => {
  it('creates generateMindmapFragment virtual tool with empty schema', () => {
    const tool = createGenerateMindmapFragmentTool()
    const schema = tool.schema as unknown as { parse: (v: unknown) => unknown }

    expect(tool.name).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
    expect(schema.parse({})).toEqual({})
    expect(() => schema.parse({ source: { type: 'pdf', path: '/test.pdf' } })).toThrow()
  })

  it('creates generatePalace virtual tool with empty schema', () => {
    const tool = createGeneratePalaceTool()
    const schema = tool.schema as unknown as { parse: (v: unknown) => unknown }

    expect(tool.name).toBe(GENERATE_PALACE_TOOL)
    expect(schema.parse({})).toEqual({})
    expect(() =>
      schema.parse({ inputText: '记忆内容', inputNodes: [{ id: 'n1', label: '节点1' }] }),
    ).toThrow()
  })
})
