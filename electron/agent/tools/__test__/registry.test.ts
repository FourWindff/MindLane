import { describe, it, expect } from 'vitest'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { ToolRegistry } from '../registry.js'
import { getToolSchemas, GENERATE_MINDMAP_FRAGMENT_TOOL } from '../../subgraphRouter.js'

function createMockTool(name: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name,
    description: `Mock tool ${name}`,
    schema: z.object({ value: z.string() }),
    func: async (input) => JSON.stringify(input),
  })
}

describe('ToolRegistry', () => {
  it('starts empty', () => {
    const registry = new ToolRegistry()

    expect(registry.allTools).toEqual([])
    expect(registry.executableTools).toEqual([])
  })

  it('registers an executable tool into both views', () => {
    const registry = new ToolRegistry()
    const mockTool = createMockTool('mockAction')

    registry.registerTool(mockTool)

    expect(registry.allTools).toContain(mockTool)
    expect(registry.executableTools).toContain(mockTool)
  })

  it('keeps virtual routing tools out of executableTools', () => {
    const registry = new ToolRegistry()
    const routingTool = getToolSchemas()[0]

    registry.registerTool(routingTool)

    expect(registry.allTools).toContain(routingTool)
    expect(registry.executableTools).not.toContain(routingTool)
    expect(routingTool.name).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
  })

  it('throws when registering a tool with a duplicate name', () => {
    const registry = new ToolRegistry()
    const mockTool = createMockTool('uniqueTool')

    registry.registerTool(mockTool)

    expect(() => registry.registerTool(createMockTool('uniqueTool'))).toThrow(
      'Tool "uniqueTool" is already registered',
    )
  })

  it('maintains separate lists for each registry instance', () => {
    const registryA = new ToolRegistry()
    const registryB = new ToolRegistry()

    registryA.registerTool(createMockTool('toolA'))
    registryB.registerTool(createMockTool('toolB'))

    expect(registryA.allTools.map((t) => t.name)).toEqual(['toolA'])
    expect(registryB.allTools.map((t) => t.name)).toEqual(['toolB'])
  })

  it('creates an immutable snapshot isolated from later registrations', () => {
    const registry = new ToolRegistry()
    registry.registerTool(createMockTool('initial'))

    const snapshot = registry.snapshot()
    registry.registerTool(createMockTool('late'))

    expect(snapshot.allTools.map((tool) => tool.name)).toEqual(['initial'])
    expect(() => snapshot.registerTool(createMockTool('other'))).toThrow()
  })
})
