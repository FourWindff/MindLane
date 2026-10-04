import { describe, it, expect } from 'vitest'
import {
  detect,
  getToolSchemas,
  isSubgraphCall,
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
  type ToolCallLike,
} from '../subgraphRouter.js'

describe('SubgraphRouter.getToolSchemas', () => {
  it('returns the two virtual tools, mindmap and palace', () => {
    const tools = getToolSchemas()

    expect(tools.map((t) => t.name)).toEqual([GENERATE_MINDMAP_FRAGMENT_TOOL, GENERATE_PALACE_TOOL])
  })

  it('tool schemas are empty and strict, rejecting extra fields', () => {
    const tools = getToolSchemas()

    for (const tool of tools) {
      const schema = tool.schema as unknown as { parse: (v: unknown) => unknown }
      expect(schema.parse({})).toEqual({})
      expect(() => schema.parse({ extra: 'value' })).toThrow()
    }
  })

  it('tool descriptions carry the meaning of generating a mindmap / memory palace', () => {
    const tools = getToolSchemas()

    const mindmapTool = tools.find((t) => t.name === GENERATE_MINDMAP_FRAGMENT_TOOL)
    const palaceTool = tools.find((t) => t.name === GENERATE_PALACE_TOOL)

    expect(mindmapTool?.description).toMatch(/mindmap/i)
    expect(palaceTool?.description).toMatch(/memory palace/i)
  })

  it('the mindmap generation tool description carries the "when to use the subgraph" criteria (short content written directly / documents or long text go through this tool)', () => {
    const mindmapTool = getToolSchemas().find((t) => t.name === GENERATE_MINDMAP_FRAGMENT_TOOL)

    expect(mindmapTool?.description).toContain('insertXmlFragment')
    expect(mindmapTool?.description).toMatch(/document/i)
    expect(mindmapTool?.description).toMatch(/long text/i)
    expect(mindmapTool?.description).toMatch(/short content/i)
  })
})

describe('SubgraphRouter.isSubgraphCall', () => {
  it('recognizes known virtual tool names as subgraph calls', () => {
    expect(isSubgraphCall(GENERATE_MINDMAP_FRAGMENT_TOOL)).toBe(true)
    expect(isSubgraphCall(GENERATE_PALACE_TOOL)).toBe(true)
  })

  it('excludes plain action tool names', () => {
    expect(isSubgraphCall('batchAddMindmapNodes')).toBe(false)
    expect(isSubgraphCall('unknown')).toBe(false)
  })
})

describe('SubgraphRouter.detect', () => {
  it('recognizes generateMindmapFragment as a mindmap subgraph call', () => {
    const toolCalls: ToolCallLike[] = [{ name: GENERATE_MINDMAP_FRAGMENT_TOOL, id: 'call-1' }]

    const result = detect(toolCalls)

    expect(result).toEqual([
      {
        subgraph: 'mindmap',
        toolCallId: 'call-1',
        toolName: GENERATE_MINDMAP_FRAGMENT_TOOL,
      },
    ])
  })

  it('recognizes generatePalace as a palace subgraph call', () => {
    const toolCalls: ToolCallLike[] = [{ name: GENERATE_PALACE_TOOL, id: 'call-2' }]

    const result = detect(toolCalls)

    expect(result).toEqual([
      {
        subgraph: 'palace',
        toolCallId: 'call-2',
        toolName: GENERATE_PALACE_TOOL,
      },
    ])
  })

  it('returns every subgraph call (a second call in the same round is no longer dropped)', () => {
    const toolCalls: ToolCallLike[] = [
      { name: 'batchAddMindmapNodes', id: 'call-1' },
      { name: GENERATE_PALACE_TOOL, id: 'call-2' },
      { name: GENERATE_MINDMAP_FRAGMENT_TOOL, id: 'call-3' },
    ]

    const result = detect(toolCalls)

    expect(result.map((call) => call.subgraph)).toEqual(['palace', 'mindmap'])
    expect(result.map((call) => call.toolCallId)).toEqual(['call-2', 'call-3'])
  })

  it('returns an empty list when there are no subgraph calls', () => {
    const toolCalls: ToolCallLike[] = [{ name: 'batchAddMindmapNodes', id: 'call-1' }]

    expect(detect(toolCalls)).toEqual([])
  })

  it('returns an empty list for an empty list', () => {
    expect(detect([])).toEqual([])
  })
})
