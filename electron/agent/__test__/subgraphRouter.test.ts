import { describe, it, expect } from 'vitest'
import {
  detect,
  getToolSchemas,
  isSubgraphCall,
  packageResult,
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
  type ToolCallLike,
} from '../subgraphRouter.js'
import type { MainGraphStateType } from '../state.js'

function createMinimalState(overrides: Partial<MainGraphStateType> = {}): MainGraphStateType {
  return {
    messages: [],
    context: null,
    pendingSubgraph: null,
    response: '',
    error: '',
    mindmapInputSource: null,
    mindmapInputTitle: '',
    mindmapXml: '',
    mindmapTitle: '',
    documentBatches: [],
    batchIndex: -1,
    leafResults: [],
    mergeInputs: [],
    mergeGroup: null,
    mergeResults: [],
    finalTree: null,
    documentRef: null,
    mindmapError: '',
    mindmapResponse: '',
    mindmapToolSteps: [],
    mindmapToolCallId: '',
    mindmapToolName: '',
    palaceError: '',
    palaceResponse: '',
    palaceToolSteps: [],
    palaceToolCallId: '',
    palaceToolName: '',
    palaceInputText: '',
    palaceInputNodes: [],
    palace: null,
    imageUrls: [],
    memoryRoute: [],
    ...overrides,
  } as MainGraphStateType
}

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

    expect(result).toEqual({
      subgraph: 'mindmap',
      toolCallId: 'call-1',
      toolName: GENERATE_MINDMAP_FRAGMENT_TOOL,
    })
  })

  it('识别 generatePalace 为 palace 子图调用', () => {
    const toolCalls: ToolCallLike[] = [{ name: GENERATE_PALACE_TOOL, id: 'call-2' }]

    const result = detect(toolCalls)

    expect(result).toEqual({
      subgraph: 'palace',
      toolCallId: 'call-2',
      toolName: GENERATE_PALACE_TOOL,
    })
  })

  it('返回列表中第一个子图调用', () => {
    const toolCalls: ToolCallLike[] = [
      { name: 'batchAddMindmapNodes', id: 'call-1' },
      { name: GENERATE_PALACE_TOOL, id: 'call-2' },
      { name: GENERATE_MINDMAP_FRAGMENT_TOOL, id: 'call-3' },
    ]

    const result = detect(toolCalls)

    expect(result?.subgraph).toBe('palace')
    expect(result?.toolCallId).toBe('call-2')
  })

  it('没有子图调用时返回 null', () => {
    const toolCalls: ToolCallLike[] = [{ name: 'batchAddMindmapNodes', id: 'call-1' }]

    expect(detect(toolCalls)).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(detect([])).toBeNull()
  })
})

describe('SubgraphRouter.packageResult', () => {
  it('mindmap 成功路径生成正确 ToolMessage', () => {
    const state = createMinimalState({
      pendingSubgraph: 'mindmap',
      mindmapToolCallId: 'call-mindmap',
      mindmapToolName: GENERATE_MINDMAP_FRAGMENT_TOOL,
      mindmapTitle: '测试导图',
      mindmapXml: 'root:\n  - child',
      mindmapToolSteps: [
        { step: 'reading-doc' },
        { step: 'extracting', completed: 1, total: 1 },
        { step: 'finalizing' },
      ],
    })

    const result = packageResult(state)

    expect(result.messages).toHaveLength(1)
    const toolMessage = result.messages[0]
    expect(toolMessage.tool_call_id).toBe('call-mindmap')
    expect(toolMessage.name).toBe(GENERATE_MINDMAP_FRAGMENT_TOOL)
    expect(JSON.parse(toolMessage.content as string)).toEqual({
      ok: true,
      title: '测试导图',
      xmlFragment: 'root:\n  - child',
      documentRef: null,
    })
    expect(toolMessage.additional_kwargs.toolSteps).toEqual([
      { step: 'reading-doc' },
      { step: 'extracting', completed: 1, total: 1 },
      { step: 'finalizing' },
    ])
    expect(result.pendingSubgraph).toBeNull()
    expect(result.mindmapToolCallId).toBe('')
    expect(result.mindmapToolName).toBe('')
  })

  it('palace 成功路径把阶段轨迹带进 toolSteps', () => {
    const state = createMinimalState({
      pendingSubgraph: 'palace',
      palaceToolCallId: 'call-palace',
      palaceToolName: GENERATE_PALACE_TOOL,
      // 另一个子图的调用信息不属于本次收口，不该被清掉。
      mindmapToolCallId: 'call-mindmap',
      palace: { theme: '测试宫殿', stations: [] },
      memoryRoute: [{ order: 1, content: '第一站', x: 0.1, y: 0.2 }],
      palaceToolSteps: [
        { step: 'planning-stations' },
        { step: 'generating-image' },
        { step: 'locating-stations' },
      ],
    })

    const result = packageResult(state)

    expect(result.messages[0].additional_kwargs.toolSteps).toEqual([
      { step: 'planning-stations' },
      { step: 'generating-image' },
      { step: 'locating-stations' },
    ])
    expect(result.palaceToolCallId).toBe('')
    expect(result.palaceToolName).toBe('')
    expect(result.mindmapToolCallId).toBeUndefined()
  })

  it('palace 成功路径直接使用 state.imageUrls 中的 data URL', () => {
    const state = createMinimalState({
      pendingSubgraph: 'palace',
      palaceToolCallId: 'call-palace',
      palaceToolName: GENERATE_PALACE_TOOL,
      palace: { theme: '测试宫殿', stations: [] },
      imageUrls: ['data:image/png;base64,abc123'],
      memoryRoute: [
        {
          order: 1,
          content: '第一站',
          x: 0.1,
          y: 0.2,
          anchorVisual: 'anchor',
          association: 'assoc',
          linkedNodeId: 'node-1',
        },
      ],
      palaceInputNodes: [{ id: 'node-1', label: '节点1' }],
    })

    const result = packageResult(state)

    expect(JSON.parse(result.messages[0].content as string)).toEqual({
      ok: true,
      label: '测试宫殿',
      stations: [
        {
          order: 1,
          content: '第一站',
          anchorVisual: 'anchor',
          association: 'assoc',
          x: 0.1,
          y: 0.2,
          linkedNodeId: 'node-1',
        },
      ],
      imageUrl: 'data:image/png;base64,abc123',
      sourceNodeIds: ['node-1'],
    })
  })

  it('palace 缺省 theme 时使用默认 label', () => {
    const state = createMinimalState({
      pendingSubgraph: 'palace',
      palaceToolCallId: 'call-palace',
      palaceToolName: GENERATE_PALACE_TOOL,
      palace: null,
      memoryRoute: [{ order: 1, content: '站1', x: 0, y: 0 }],
    })

    const result = packageResult(state)

    expect(JSON.parse(result.messages[0].content as string)).toMatchObject({
      ok: true,
      label: '记忆宫殿 (1 站)',
    })
  })

  it('mindmapError 时返回错误 payload', () => {
    const state = createMinimalState({
      pendingSubgraph: 'mindmap',
      mindmapToolCallId: 'call-error',
      mindmapToolName: GENERATE_MINDMAP_FRAGMENT_TOOL,
      mindmapError: '子图执行失败',
      mindmapResponse: '执行时出错',
    })

    const result = packageResult(state)

    expect(JSON.parse(result.messages[0].content as string)).toEqual({
      ok: false,
      error: '执行时出错',
    })
    expect(result.pendingSubgraph).toBeNull()
    expect(result.mindmapToolCallId).toBe('')
    expect(result.mindmapToolName).toBe('')
  })
})
