import { describe, it, expect, vi } from 'vitest'
import { buildMindmapSubgraph } from '../index.js'
import type { LLMProvider } from '../../../providers/index.js'
import { extractYaml, sanitizeTreeCandidate, normalizeTree } from '../../../utils/yamlMindmap.js'
import type { MindmapYamlNode } from '../../../utils/yamlMindmap.js'
import { MindmapInputAnalyzer } from '../analyzers/types.js'
import type { DocumentChunk, MindmapInputSource } from '../analyzers/types.js'

vi.mock('../analyzers/pdfAnalyzer.js', () => ({
  PdfInputAnalyzer: class {
    supports(source: { type: string }) {
      return source.type === 'pdf'
    }

    async load(path: string) {
      if (path.includes('short')) {
        return [{ pageNumber: 1, text: 'Short PDF text' }]
      }

      return [
        { pageNumber: 1, text: 'PDF text 1'.repeat(900) },
        { pageNumber: 2, text: 'PDF text 2'.repeat(900) },
        { pageNumber: 3, text: 'PDF text 3'.repeat(900) },
        { pageNumber: 4, text: 'PDF text 4'.repeat(900) },
        { pageNumber: 5, text: 'PDF text 5'.repeat(900) },
      ]
    }

    async loadDocument(source: { path?: string }) {
      if (!source.path) {
        throw new Error('PDF source requires a path')
      }

      const pages = await this.load(source.path)
      const chunks = pages.map((page, index) => ({
        id: `chunk-${index + 1}`,
        index,
        startPage: page.pageNumber,
        endPage: page.pageNumber,
        text: page.text,
      }))

      return {
        text: pages.map((page) => page.text).join('\n\n'),
        chunks,
      }
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

class TestInputAnalyzer extends MindmapInputAnalyzer<null, { text: string; chunks: DocumentChunk[] }> {
  readonly type: MindmapInputSource['type']
  readonly loadDocument = vi.fn()

  constructor(
    type: MindmapInputSource['type'],
    private readonly loaded: { text: string; chunks: DocumentChunk[] },
  ) {
    super()
    this.type = type
    this.loadDocument.mockResolvedValue(loaded)
  }

  protected resolveInput(): null {
    return null
  }

  async load(): Promise<{ text: string; chunks: DocumentChunk[] }> {
    return this.loaded
  }

  protected getText(raw: { text: string }): string {
    return raw.text
  }

  protected chunk(raw: { chunks: DocumentChunk[] }): DocumentChunk[] {
    return raw.chunks
  }
}

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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
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
      partialMergedTrees: [],
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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
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
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.mindmapYaml).toBeTruthy()
    expect(result.mindmapTitle).toBe('人工智能导论')
    expect(result.pendingSubgraph).toBeNull()
    expect(result.error).toBe('')
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(1)
  })

  it('uses single-pass extraction for a short PDF', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockResolvedValue({
          content: `
Short PDF:
  - Summary
  - Detail
`,
        }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: { type: 'pdf', path: '/tmp/short.pdf' },
      mindmapInputTitle: 'Short PDF',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('Short PDF')
    expect(result.leafResults).toHaveLength(0)
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(1)
  })

  it('routes long text through multiple chunk extraction batches instead of truncating it', async () => {
    const importantTail = 'TAIL_MARKER'
    const longText = `${'intro '.repeat(4200)}${importantTail}`
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn()
          .mockResolvedValueOnce({
            content: `
Leaf Long Text 1:
  - First Batch
`,
          })
          .mockResolvedValueOnce({
            content: `
Leaf Long Text 2:
  - Preserved Tail
`,
          })
          .mockResolvedValue({
            content: `
Merged Long Text:
  - Preserved Tail
`,
          }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: { type: 'text', content: longText },
      mindmapInputTitle: 'Long Text',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    const firstPrompt = String(
      (mockProvider.reasoningModel.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.[1]?.content ?? '',
    )
    const secondPrompt = String(
      (mockProvider.reasoningModel.invoke as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]?.[1]?.content ?? '',
    )

    expect(result.error).toBe('')
    expect(result.leafResults).toHaveLength(2)
    expect(result.mindmapYaml).toContain('Merged Long Text')
    expect(firstPrompt).not.toContain(importantTail)
    expect(secondPrompt).toContain(importantTail)
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(3)
  })

  it('loads documents through an injected analyzer registry', async () => {
    const customAnalyzer = new TestInputAnalyzer('url', {
      text: 'Loaded URL text',
      chunks: [{
        id: 'url-chunk-1',
        index: 0,
        startPage: 0,
        endPage: 0,
        text: 'Loaded URL text',
      }],
    })
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockResolvedValue({
          content: `
URL Root:
  - Loaded URL text
`,
        }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({
      provider: mockProvider,
      analyzers: [customAnalyzer],
    })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: { type: 'url', url: 'https://example.test/doc' },
      mindmapInputTitle: 'URL Root',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(customAnalyzer.loadDocument).toHaveBeenCalledWith({
      type: 'url',
      url: 'https://example.test/doc',
    })
    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('URL Root')
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(1)
  })

  it('clears stale mindmap run state before generating a new mindmap', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockResolvedValue({
          content: `
Fresh Root:
  - Fresh Child
`,
        }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: 'stale response',
      error: 'stale error',
      mindmapInputSource: { type: 'text', content: 'fresh text' },
      mindmapInputTitle: 'Fresh Root',
      mindmapYaml: 'Stale Root:\n  - Stale Child\n',
      mindmapTitle: 'Stale Root',
      documentChunks: [{
        id: 'stale-chunk',
        index: 0,
        startPage: 0,
        endPage: 0,
        text: 'stale text',
      }],
      leafCursor: 99,
      pendingLeafRange: { start: 10, end: 20 },
      leafResults: [{ chunkIndex: 0, chunkId: 'stale-chunk', tree: { label: 'Stale Leaf' } }],
      mergeInputs: [{ label: 'Stale Merge Input' }],
      partialMergedTrees: [{ label: 'Stale Partial' }],
      mergeResults: [{ groupIndex: 0, tree: { label: 'Stale Merge' } }],
      pendingMergeGroups: [{ groupIndex: 0, trees: [{ label: 'Stale Group' }] }],
      finalTree: { label: 'Stale Final' },
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('Fresh Root')
    expect(result.mindmapYaml).not.toContain('Stale Root')
    expect(result.mindmapTitle).toBe('Fresh Root')
    expect(result.leafResults).toHaveLength(0)
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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
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
      partialMergedTrees: [],
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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
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
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('人工智能导论')
    expect(result.pendingSubgraph).toBeNull()
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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
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
      partialMergedTrees: [],
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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
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
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.leafResults).toHaveLength(1)
    expect(result.mindmapYaml).toContain('Merged Root')
    expect(result.pendingSubgraph).toBeNull()
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(3)
  })

  it('stores one analysis result for a multi-chunk leaf batch', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn()
          .mockResolvedValueOnce({
            content: `
Leaf Batch:
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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
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
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.leafResults).toHaveLength(1)
    expect(result.leafResults[0]).toMatchObject({
      chunkIndex: 0,
      chunkId: 'chunk-1..chunk-5',
    })
    expect(result.mergeInputs).toHaveLength(0)
    expect(result.mindmapYaml).toContain('Merged Root')
    expect(mockProvider.reasoningModel.invoke).toHaveBeenCalledTimes(2)
  })

  it('merges a full analysis queue before dispatching remaining leaf batches', async () => {
    const chunks = Array.from({ length: 45 }, (_, index) => ({
      id: `chunk-${index + 1}`,
      index,
      startPage: index + 1,
      endPage: index + 1,
      text: `chunk ${index + 1} ${'body '.repeat(50)}`,
    }))
    const customAnalyzer = new TestInputAnalyzer('text', {
      text: chunks.map((chunk) => chunk.text).join('\n\n'),
      chunks,
    })
    const events: string[] = []
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockImplementation(async (messages: Array<{ content: string }>) => {
          const systemPrompt = messages[0]?.content ?? ''
          if (systemPrompt.includes('merging assistant')) {
            events.push('merge')
            return {
              content: `
Merged ${events.length}:
  - Combined
`,
            }
          }

          events.push('leaf')
          return {
            content: `
Leaf ${events.length}:
  - Extracted
`,
          }
        }),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({
      provider: mockProvider,
      analyzers: [customAnalyzer],
    })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
      response: '',
      error: '',
      mindmapInputSource: { type: 'text', content: 'large document' },
      mindmapInputTitle: 'Large Document',
      mindmapYaml: '',
      mindmapTitle: '',
      documentChunks: [],
      leafCursor: 0,
      pendingLeafRange: null,
      leafResults: [],
      mergeInputs: [],
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    }, {
      recursionLimit: 100,
    })

    expect(result.error).toBe('')
    expect(events.slice(0, 10)).toEqual([
      'leaf',
      'leaf',
      'leaf',
      'leaf',
      'leaf',
      'leaf',
      'leaf',
      'leaf',
      'merge',
      'leaf',
    ])
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
      pendingSubgraph: 'mindmap',
      pendingSubgraphToolCallId: '',
      pendingSubgraphToolName: '',
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
      partialMergedTrees: [],
      mergeResults: [],
      pendingMergeGroups: [],
      finalTree: null,
      documentRef: null,
    })

    expect(result.error).toBe('')
    expect(result.finalTree).toBeTruthy()
    expect(result.mindmapYaml).toContain('Merged Root')
    expect(result.pendingSubgraph).toBeNull()
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
