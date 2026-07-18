import { describe, it, expect, vi } from 'vitest'
import { Document } from '@langchain/core/documents'
import { buildMindmapSubgraph } from '../index.js'
import type { LLMProvider } from '../../../providers/index.js'
import { extractYaml, sanitizeTreeCandidate, normalizeTree } from '../../../utils/yamlMindmap.js'
import type { MindmapYamlNode } from '../../../utils/yamlMindmap.js'
import { MindmapSubgraphState } from '../../../state.js'

type InvokeMock = ReturnType<typeof vi.fn>

function mockProvider(
  impl?: (messages: Array<{ content: string }>) => unknown,
  contextWindow = 32_768,
) {
  return {
    reasoningModel: {
      invoke: impl ? vi.fn(impl) : vi.fn(),
    },
    contextWindow,
  } as unknown as LLMProvider
}

function invokeMock(provider: LLMProvider): InvokeMock {
  return provider.reasoningModel.invoke as unknown as InvokeMock
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    messages: [],
    context: null,
    pendingSubgraph: 'mindmap' as const,
    pendingSubgraphToolCallId: '',
    pendingSubgraphToolName: '',
    response: '',
    error: '',
    mindmapInputSource: null,
    mindmapInputTitle: '',
    mindmapYaml: '',
    mindmapTitle: '',
    documentBatches: [],
    leafCursor: 0,
    leafResults: [],
    mergeInputs: [],
    partialMergedTrees: [],
    mergeResults: [],
    pendingMergeGroups: [],
    finalTree: null,
    documentRef: null,
    ...overrides,
  }
}

const VALID_TREE_YAML = `
人工智能导论:
  - 机器学习:
    - 监督学习
    - 无监督学习
  - 深度学习:
    - 神经网络
    - 反向传播
`

describe('mindmapGraph', () => {
  it('returns error when no input source is provided', async () => {
    const provider = mockProvider()
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(baseInput({ mindmapInputSource: null }))

    expect(result.error).toContain('请提供要生成思维导图的文档或文本')
    expect(invokeMock(provider)).not.toHaveBeenCalled()
  })

  it('precomputes documentBatches in the load node', async () => {
    const provider = mockProvider(() => ({ content: VALID_TREE_YAML }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: '这是一篇关于人工智能的文档。' },
        mindmapInputTitle: '人工智能导论',
      }),
    )

    expect(result.error).toBe('')
    expect(result.documentBatches).toHaveLength(1)
    expect(result.documentBatches[0]![0]).toBeInstanceOf(Document)
    expect(result.documentBatches[0]![0]!.pageContent).toContain('人工智能')
  })

  it('sends a single-batch document straight to build_output without merging', async () => {
    const provider = mockProvider(() => ({ content: VALID_TREE_YAML }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: '这是一篇关于人工智能的文档。' },
        mindmapInputTitle: '人工智能导论',
      }),
    )

    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('人工智能导论')
    expect(result.mindmapTitle).toBe('人工智能导论')
    expect(result.pendingSubgraph).toBeNull()
    expect(result.leafResults).toHaveLength(1)
    expect(result.finalTree).toBeTruthy()
    expect(invokeMock(provider)).toHaveBeenCalledTimes(1)
    // the only call is leaf extraction, not merge
    const systemPrompt = String(invokeMock(provider).mock.calls[0]?.[0]?.[0]?.content ?? '')
    expect(systemPrompt).toContain('extraction assistant')
  })

  it('streams the single-batch pipeline stages', async () => {
    const provider = mockProvider(() => ({ content: 'Short Document:\n  - Summary\n' }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const steps: string[] = []
    const stream = await app.stream(
      baseInput({
        mindmapInputSource: { type: 'text', content: 'short document' },
        mindmapInputTitle: 'Short Document',
      }),
      { streamMode: 'custom' },
    )

    for await (const event of stream) {
      steps.push((event as { step: string }).step)
    }

    expect(steps).toEqual(['reading-doc', 'extracting', 'finalizing'])
  })

  it('routes a long document through leaf batches and a final merge', async () => {
    const tail = 'TAIL_MARKER'
    const para1 = 'a'.repeat(1500)
    const para2 = 'b'.repeat(1500)
    const para3 = `${'c'.repeat(1490)}${tail}`
    const longText = [para1, para2, para3].join('\n\n')
    // small window → 409-char budget → each chunk gets its own batch
    const provider = mockProvider((messages) => {
      const systemPrompt = messages[0]?.content ?? ''
      if (systemPrompt.includes('merging assistant')) {
        return { content: 'Merged Long Text:\n  - Preserved Tail\n' }
      }
      return { content: 'Leaf Tree:\n  - Extracted\n' }
    }, 512)
    const app = buildMindmapSubgraph({ provider }).compile()

    const steps: string[] = []
    let result!: typeof MindmapSubgraphState.State
    const stream = await app.stream(
      baseInput({
        mindmapInputSource: { type: 'text', content: longText },
        mindmapInputTitle: 'Long Text',
      }),
      { streamMode: ['custom', 'values'] },
    )

    for await (const [mode, event] of stream) {
      if (mode === 'custom') steps.push((event as { step: string }).step)
      if (mode === 'values') result = event as typeof MindmapSubgraphState.State
    }

    const calls = invokeMock(provider).mock.calls
    const firstPrompt = String(calls[0]?.[0]?.[1]?.content ?? '')
    const thirdPrompt = String(calls[2]?.[0]?.[1]?.content ?? '')

    expect(result.error).toBe('')
    expect(result.documentBatches).toHaveLength(3)
    expect(result.leafResults).toHaveLength(3)
    expect(result.mindmapYaml).toContain('Merged Long Text')
    expect(firstPrompt).not.toContain(tail)
    expect(thirdPrompt).toContain(tail)
    expect(invokeMock(provider)).toHaveBeenCalledTimes(4)
    expect(steps[0]).toBe('reading-doc')
    expect(steps.filter((step) => step === 'extracting')).toHaveLength(3)
    expect(steps).toContain('merging')
    expect(steps.at(-1)).toBe('finalizing')
  })

  it('grows batch size with the model context window', async () => {
    const longText = ['a'.repeat(1500), 'b'.repeat(1500), 'c'.repeat(1500)].join('\n\n')
    const smallWindow = mockProvider(() => ({ content: 'Tree:\n  - X\n' }), 512)
    const largeWindow = mockProvider(() => ({ content: 'Tree:\n  - X\n' }), 128_000)

    const smallResult = await buildMindmapSubgraph({ provider: smallWindow })
      .compile()
      .invoke(baseInput({ mindmapInputSource: { type: 'text', content: longText } }))
    const largeResult = await buildMindmapSubgraph({ provider: largeWindow })
      .compile()
      .invoke(baseInput({ mindmapInputSource: { type: 'text', content: longText } }))

    expect(smallResult.documentBatches.length).toBeGreaterThan(largeResult.documentBatches.length)
    expect(largeResult.documentBatches).toHaveLength(1)
    expect(invokeMock(largeWindow)).toHaveBeenCalledTimes(1)
  })

  it('loads URL input through an injected loader', async () => {
    const urlLoader = vi.fn().mockResolvedValue([new Document({ pageContent: 'Loaded URL text' })])
    const provider = mockProvider(() => ({ content: 'URL Root:\n  - Loaded URL text\n' }))
    const app = buildMindmapSubgraph({
      provider,
      loaders: { url: urlLoader },
    }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'url', url: 'https://example.test/doc' },
        mindmapInputTitle: 'URL Root',
      }),
    )

    expect(urlLoader).toHaveBeenCalledWith({ type: 'url', url: 'https://example.test/doc' })
    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('URL Root')
    expect(result.documentRef?.type).toBe('url')
    expect(invokeMock(provider)).toHaveBeenCalledTimes(1)
  })

  it('returns a clear error when the document has no extractable text', async () => {
    const pdfLoader = vi.fn().mockResolvedValue([new Document({ pageContent: '' })])
    const provider = mockProvider()
    const app = buildMindmapSubgraph({ provider, loaders: { pdf: pdfLoader } }).compile()

    const result = await app.invoke(
      baseInput({ mindmapInputSource: { type: 'pdf', path: '/tmp/blank.pdf' } }),
    )

    expect(result.error).toContain('文档未能提取出任何文本内容')
    expect(invokeMock(provider)).not.toHaveBeenCalled()
  })

  it('returns a clear error when the loader fails', async () => {
    const urlLoader = vi.fn().mockRejectedValue(new Error('fetch failed: HTTP 404'))
    const provider = mockProvider()
    const app = buildMindmapSubgraph({ provider, loaders: { url: urlLoader } }).compile()

    const result = await app.invoke(
      baseInput({ mindmapInputSource: { type: 'url', url: 'https://example.test/missing' } }),
    )

    expect(result.error).toContain('fetch failed')
    expect(result.response).toContain('加载文档失败')
    expect(invokeMock(provider)).not.toHaveBeenCalled()
  })

  it('clears stale mindmap run state before generating a new mindmap', async () => {
    const provider = mockProvider(() => ({ content: 'Fresh Root:\n  - Fresh Child\n' }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        response: 'stale response',
        error: 'stale error',
        mindmapInputSource: { type: 'text', content: 'fresh text' },
        mindmapInputTitle: 'Fresh Root',
        mindmapYaml: 'Stale Root:\n  - Stale Child\n',
        mindmapTitle: 'Stale Root',
        documentBatches: [[new Document({ pageContent: 'stale text' })]],
        leafCursor: 99,
        leafResults: [{ batchIndex: 0, batchId: 'stale-batch', tree: { label: 'Stale Leaf' } }],
        mergeInputs: [{ label: 'Stale Merge Input' }],
        partialMergedTrees: [{ label: 'Stale Partial' }],
        mergeResults: [{ groupIndex: 0, tree: { label: 'Stale Merge' } }],
        pendingMergeGroups: [{ groupIndex: 0, trees: [{ label: 'Stale Group' }] }],
        finalTree: { label: 'Stale Final' },
      }),
    )

    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('Fresh Root')
    expect(result.mindmapYaml).not.toContain('Stale Root')
    expect(result.mindmapTitle).toBe('Fresh Root')
    expect(result.leafResults).toHaveLength(1)
    expect(invokeMock(provider)).toHaveBeenCalledTimes(1)
  })

  it('includes stack trace in state.error when generation fails', async () => {
    const provider = mockProvider(() => {
      throw new Error('LLM timeout')
    })
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({ mindmapInputSource: { type: 'text', content: 'some document text' } }),
    )

    expect(result.error).toContain('LLM timeout')
    expect(result.error).toContain('at') // stack trace
  })

  it('retries leaf extraction when generated YAML is invalid', async () => {
    const provider = mockProvider()
    invokeMock(provider)
      .mockResolvedValueOnce({ content: 'mindmap: ":\n  - "unclosed' })
      .mockResolvedValueOnce({ content: VALID_TREE_YAML })
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: '这是一篇关于人工智能的文档。' },
        mindmapInputTitle: '人工智能导论',
      }),
    )

    expect(result.error).toBe('')
    expect(result.mindmapYaml).toContain('人工智能导论')
    expect(invokeMock(provider)).toHaveBeenCalledTimes(2)
  })

  it('returns an error after repeated invalid YAML output', async () => {
    const provider = mockProvider(() => ({ content: 'mindmap: ":\n  - "unclosed' }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({ mindmapInputSource: { type: 'text', content: 'some document text' } }),
    )

    expect(result.error).toContain('YAML 校验失败：Unexpected scalar at node end')
    expect(result.mindmapYaml).toBe('')
    expect(invokeMock(provider)).toHaveBeenCalledTimes(3)
  })

  it('retries merge before storing merge results', async () => {
    const longText = ['a'.repeat(1500), 'b'.repeat(1500)].join('\n\n')
    // small window puts each paragraph in its own batch
    const provider = mockProvider(undefined, 512)
    invokeMock(provider)
      .mockResolvedValueOnce({ content: 'Leaf A:\n  - Child A\n' })
      .mockResolvedValueOnce({ content: 'Leaf B:\n  - Child B\n' })
      .mockResolvedValueOnce({ content: 'mindmap: ":\n  - "unclosed' })
      .mockResolvedValueOnce({ content: 'Merged Root:\n  - Child A\n  - Child B\n' })
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: longText },
        mindmapInputTitle: 'PDF Root',
      }),
    )

    expect(result.error).toBe('')
    expect(result.leafResults).toHaveLength(2)
    expect(result.finalTree).toBeTruthy()
    expect(result.mindmapYaml).toContain('Merged Root')
    expect(invokeMock(provider)).toHaveBeenCalledTimes(4)
  })

  it('merges a full analysis queue before dispatching remaining leaf batches', async () => {
    // 9 paragraphs of ~1900 chars → 9 chunks; small window gives each its own batch
    const paragraphs = Array.from({ length: 9 }, (_, i) => `p${i}${'w'.repeat(1898)}`)
    const longText = paragraphs.join('\n\n')
    const events: string[] = []
    const provider = mockProvider((messages) => {
      const systemPrompt = messages[0]?.content ?? ''
      if (systemPrompt.includes('merging assistant')) {
        events.push('merge')
        return { content: `Merged ${events.length}:\n  - Combined\n` }
      }
      events.push('leaf')
      return { content: `Leaf ${events.length}:\n  - Extracted\n` }
    }, 512)
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: longText },
        mindmapInputTitle: 'Large Document',
      }),
      {
        recursionLimit: 100,
      },
    )

    expect(result.error).toBe('')
    expect(result.leafResults).toHaveLength(9)
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
})

describe('mindmapGraph YAML parsing', () => {
  it('parses outline-format YAML into structured tree', () => {
    const parsed = extractYaml(VALID_TREE_YAML)
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
      children: [{ label: 'Child', page_range: '', children: [] }],
    }
    const normalized = normalizeTree(raw, '')
    expect(normalized.label).toBe('Test')
    expect(normalized.page_range).toBe('')
  })
})
