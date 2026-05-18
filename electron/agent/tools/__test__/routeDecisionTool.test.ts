import { describe, it, expect } from 'vitest'
import { createRouteDecisionTool } from '../routeDecisionTool.js'

describe('createRouteDecisionTool', () => {
  it('should allow palace target when hasPalace is true', () => {
    const tool = createRouteDecisionTool(true)
    expect(tool.description).toContain('palace')
    const schema = tool.schema as unknown as { parse: (v: unknown) => { target: string } }
    const parsed = schema.parse({ target: 'palace' })
    expect(parsed.target).toBe('palace')
  })

  it('should reject palace target when hasPalace is false', () => {
    const tool = createRouteDecisionTool(false)
    expect(tool.description).not.toContain('palace')
    const schema = tool.schema as unknown as { parse: (v: unknown) => unknown }
    expect(() => schema.parse({ target: 'palace' })).toThrow()
  })

  it('should always allow qa and mindmap targets', () => {
    const toolWithPalace = createRouteDecisionTool(true)
    const schemaWith = toolWithPalace.schema as unknown as { parse: (v: unknown) => unknown }
    expect(() => schemaWith.parse({ target: 'qa' })).not.toThrow()
    expect(() => schemaWith.parse({ target: 'mindmap' })).not.toThrow()

    const toolWithoutPalace = createRouteDecisionTool(false)
    const schemaWithout = toolWithoutPalace.schema as unknown as { parse: (v: unknown) => unknown }
    expect(() => schemaWithout.parse({ target: 'qa' })).not.toThrow()
    expect(() => schemaWithout.parse({ target: 'mindmap' })).not.toThrow()
  })
})
