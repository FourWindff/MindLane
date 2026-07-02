import { describe, it, expect } from 'vitest'
import {
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
} from '../tools/subgraphRoutingTools.js'
import { route, type ToolCallLike } from '../subgraphRouter.js'

describe('subgraphRouter', () => {
  it('routes generateMindmapFragment to mindmap subgraph', () => {
    const toolCall: ToolCallLike = {
      name: GENERATE_MINDMAP_FRAGMENT_TOOL,
      id: 'tool_001',
    }

    const result = route(toolCall, null, [])

    expect(result).toEqual({
      subgraph: 'mindmap',
      toolCallId: 'tool_001',
      toolName: GENERATE_MINDMAP_FRAGMENT_TOOL,
    })
  })

  it('routes generatePalace to palace subgraph', () => {
    const toolCall: ToolCallLike = {
      name: GENERATE_PALACE_TOOL,
      id: 'tool_002',
    }

    const result = route(toolCall, null, [])

    expect(result).toEqual({
      subgraph: 'palace',
      toolCallId: 'tool_002',
      toolName: GENERATE_PALACE_TOOL,
    })
  })

  it('returns null for ordinary action tools', () => {
    const toolCall: ToolCallLike = { name: 'batchAddMindmapNodes', id: 'tool_003' }

    const result = route(toolCall, null, [])

    expect(result).toBeNull()
  })

  it('defaults toolCallId to empty string when id is missing', () => {
    const toolCall: ToolCallLike = { name: GENERATE_MINDMAP_FRAGMENT_TOOL }

    const result = route(toolCall, null, [])

    expect(result?.toolCallId).toBe('')
  })
})
