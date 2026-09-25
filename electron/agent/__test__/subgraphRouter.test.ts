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
  it('返回 mindmap 与 palace 两个虚拟工具', () => {
    const tools = getToolSchemas()

    expect(tools.map((t) => t.name)).toEqual([GENERATE_MINDMAP_FRAGMENT_TOOL, GENERATE_PALACE_TOOL])
  })

  it('工具 schema 为空且严格，拒绝额外字段', () => {
    const tools = getToolSchemas()

    for (const tool of tools) {
      const schema = tool.schema as unknown as { parse: (v: unknown) => unknown }
      expect(schema.parse({})).toEqual({})
      expect(() => schema.parse({ extra: 'value' })).toThrow()
    }
  })

  it('工具描述包含生成思维导图/记忆宫殿的语义', () => {
    const tools = getToolSchemas()

    const mindmapTool = tools.find((t) => t.name === GENERATE_MINDMAP_FRAGMENT_TOOL)
    const palaceTool = tools.find((t) => t.name === GENERATE_PALACE_TOOL)

    expect(mindmapTool?.description).toContain('思维导图')
    expect(palaceTool?.description).toContain('记忆宫殿')
  })

  it('导图生成工具的描述携带「何时该用子图」的判据（短内容自写 / 文档或长文本走本工具）', () => {
    const mindmapTool = getToolSchemas().find((t) => t.name === GENERATE_MINDMAP_FRAGMENT_TOOL)

    expect(mindmapTool?.description).toContain('insertXmlFragment')
    expect(mindmapTool?.description).toContain('文档')
    expect(mindmapTool?.description).toContain('长文本')
    expect(mindmapTool?.description).toContain('短内容')
  })
})

describe('SubgraphRouter.isSubgraphCall', () => {
  it('将已知虚拟工具名识别为子图调用', () => {
    expect(isSubgraphCall(GENERATE_MINDMAP_FRAGMENT_TOOL)).toBe(true)
    expect(isSubgraphCall(GENERATE_PALACE_TOOL)).toBe(true)
  })

  it('将普通 action 工具名排除在外', () => {
    expect(isSubgraphCall('batchAddMindmapNodes')).toBe(false)
    expect(isSubgraphCall('unknown')).toBe(false)
  })
})

describe('SubgraphRouter.detect', () => {
  it('识别 generateMindmapFragment 为 mindmap 子图调用', () => {
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

  it('识别 generatePalace 为 palace 子图调用', () => {
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

  it('返回全部子图调用（同一轮里的第二个调用不再被丢弃）', () => {
    const toolCalls: ToolCallLike[] = [
      { name: 'batchAddMindmapNodes', id: 'call-1' },
      { name: GENERATE_PALACE_TOOL, id: 'call-2' },
      { name: GENERATE_MINDMAP_FRAGMENT_TOOL, id: 'call-3' },
    ]

    const result = detect(toolCalls)

    expect(result.map((call) => call.subgraph)).toEqual(['palace', 'mindmap'])
    expect(result.map((call) => call.toolCallId)).toEqual(['call-2', 'call-3'])
  })

  it('没有子图调用时返回空列表', () => {
    const toolCalls: ToolCallLike[] = [{ name: 'batchAddMindmapNodes', id: 'call-1' }]

    expect(detect(toolCalls)).toEqual([])
  })

  it('空列表返回空列表', () => {
    expect(detect([])).toEqual([])
  })
})
