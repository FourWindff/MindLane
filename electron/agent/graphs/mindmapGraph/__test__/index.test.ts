import { describe, it, expect, vi } from 'vitest'
import { buildMindmapSubgraph } from '../index.js'
import type { LLMProvider } from '../../../providers/index.js'
import { extractYaml, sanitizeTreeCandidate, normalizeTree } from '../../../utils/yamlMindmap.js'
import type { MindmapYamlNode } from '../../../utils/yamlMindmap.js'

vi.mock('../loaders/pdfLoader.js', () => ({
  PdfDocumentLoader: class {
    async load() {
      return [{ pageNumber: 1, text: 'PDF text' }]
    }
  },
  chunkPages: (pages: Array<{ pageNumber: number; text: string }>) => pages.map((page, index) => ({
    id: `chunk-${index + 1}`,
    index,
    startPage: page.pageNumber,
    endPage: page.pageNumber,
    text: page.text,
  })),
}))

describe('mindmapGraph', () => {
  it('returns error when no input source is provided', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn(),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputSource: null,
      mindmapInputTitle: '',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toContain('请提供输入来源')
    expect(mockProvider.reasoningModel.invoke).not.toHaveBeenCalled()
  })

  it('produces YAML output for text input', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockResolvedValue({
          content: `
人工智能导论:
  - 机器学习:
    - 监督学习
    - 无监督学习
  - 深度学习:
    - 神经网络
    - 反向传播
`,
        }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputSource: { type: 'text', content: '这是一篇关于人工智能的文档。' },
      mindmapInputTitle: '人工智能导论',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.mindmapYaml).toBeTruthy()
    expect(result.mindmapTitle).toBe('人工智能导论')
    expect(result.intent).toBe('qa')
    expect(result.error).toBe('')
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(1)
  })

  it('includes stack trace in state.error when generation fails', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputSource: { type: 'text', content: 'some document text' },
      mindmapInputTitle: '',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toContain('LLM timeout')
    expect(result.error).toContain('at') // stack trace
  })

  it('retries text extraction when generated YAML is invalid', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn()
          .mockResolvedValueOnce({ content: 'mindmap: ":\n  - "unclosed' })
          .mockResolvedValueOnce({
            content: `
人工智能导论:
  - 机器学习
  - 深度学习
`,
          }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputSource: { type: 'text', content: '这是一篇关于人工智能的文档。' },
      mindmapInputTitle: '人工智能导论',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('人工智能导论')
    expect(result.intent).toBe('qa')
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(2)
  })

  it('returns an error after repeated invalid YAML output', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockResolvedValue({ content: 'mindmap: ":\n  - "unclosed' }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputSource: { type: 'text', content: 'some document text' },
      mindmapInputTitle: '',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toContain('YAML 校验失败：Unexpected scalar at node end')
    expect(result.mindmapYaml).toBe('')
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(3)
  })

  it('retries leaf extraction before storing leaf results', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn()
          .mockResolvedValueOnce({ content: 'mindmap: ":\n  - "unclosed' })
          .mockResolvedValueOnce({
            content: `
Leaf Root:
  - Leaf A
  - Leaf B
`,
          })
          .mockResolvedValue({
            content: `
Merged Root:
  - Leaf A
  - Leaf B
`,
          }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputSource: { type: 'pdf', path: '/tmp/test.pdf' },
      mindmapInputTitle: 'PDF Root',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [{
        id: 'chunk-1',
        index: 0,
        startPage: 1,
        endPage: 1,
        text: 'PDF text',
      }],
      leafCursor: 0,
      pendingLeafRange: { start: 0, end: 1 },
      leafResults: [],
      mergeInputs: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.leafResults).toHaveLength(1)
    expect(result.mindmapYaml).toContain('Merged Root')
    expect(result.intent).toBe('qa')
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(3)
  })

  it('retries merge before storing merge results', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn()
          .mockResolvedValueOnce({
            content: `
Leaf Root:
  - Child A
  - Child B
`,
          })
          .mockResolvedValueOnce({ content: 'mindmap: ":\n  - "unclosed' })
          .mockResolvedValueOnce({
            content: `
Merged Root:
  - Child A
  - Child B
`,
          }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputSource: { type: 'pdf', path: '/tmp/test.pdf' },
      mindmapInputTitle: 'PDF Root',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [{
        label: 'Root A',
        page_range: '',
        children: [{ label: 'Child A', page_range: '', children: [] }],
      }, {
        label: 'Root B',
        page_range: '',
        children: [{ label: 'Child B', page_range: '', children: [] }],
      }],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.mergeResults).toHaveLength(1)
    expect(result.mindmapYaml).toContain('Merged Root')
    expect(result.intent).toBe('qa')
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(3)
  })
})

describe('mindmapGraph YAML parsing', () => {
  it('parses outline-format YAML into structured tree', () => {
    const yaml = `
人工智能导论:
  - 机器学习:
    - 监督学习
    - 无监督学习
  - 深度学习:
    - 神经网络
    - 反向传播
`
    const parsed = extractYaml(yaml)
    const tree = sanitizeTreeCandidate(parsed)

    expect(tree).toMatchObject({
      label: '人工智能导论',
      children: expect.any(Array),
    })
    expect((tree as MindmapYamlNode).children).toHaveLength(2)
    expect((tree as MindmapYamlNode).children![0]!.label).toBe('机器学习')
    expect((tree as MindmapYamlNode).children![0]!.children).toHaveLength(2)
  })

  it('parses structured-format YAML', () => {
    const yaml = `
label: 人工智能导论
children:
  - label: 机器学习
    children:
      - label: 监督学习
      - label: 无监督学习
`
    const parsed = extractYaml(yaml)
    const tree = sanitizeTreeCandidate(parsed)

    expect(tree).toMatchObject({
      label: '人工智能导论',
      children: expect.any(Array),
    })
    expect((tree as MindmapYamlNode).children).toHaveLength(1)
  })

  it('handles deeply nested outline format', () => {
    const yaml = `
Root:
  - A:
    - A1:
      - A1a
      - A1b
    - A2
  - B:
    - B1
`
    const parsed = extractYaml(yaml)
    const tree = sanitizeTreeCandidate(parsed) as MindmapYamlNode

    expect(tree.label).toBe('Root')
    expect(tree.children).toHaveLength(2)
    expect(tree.children![0]!.children).toHaveLength(2)
    expect(tree.children![0]!.children![0]!.children).toHaveLength(2)
  })

  it('handles single node without children', () => {
    const yaml = 'Simple Topic:'
    const parsed = extractYaml(yaml)
    const tree = sanitizeTreeCandidate(parsed) as MindmapYamlNode

    expect(tree.label).toBe('Simple Topic')
    expect(tree.children).toEqual([])
  })

  it('normalizes tree with empty page_range and summary', () => {
    const raw: MindmapYamlNode = {
      label: '  Test  ',
      page_range: '',
      children: [
        { label: 'Child', page_range: '', children: [] },
      ],
    }
    const normalized = normalizeTree(raw, '')
    expect(normalized.label).toBe('Test')
    expect(normalized.page_range).toBe('')
  })
})
