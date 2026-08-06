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
    batchIndex: -1,
    leafResults: [],
    mergeInputs: [],
    mergeGroup: null,
    mergeResults: [],
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

    expect(steps).toEqual(['reading-doc', 'extracting', 'extracting', 'finalizing'])
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
    // one phase-start event plus one per completed batch
    expect(steps.filter((step) => step === 'extracting')).toHaveLength(4)
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

  it('records file-backed document metadata through an injected office loader', async () => {
    const docxLoader = vi.fn().mockResolvedValue([new Document({ pageContent: 'Office text' })])
    const provider = mockProvider(() => ({ content: 'Office Root:\n  - Office text\n' }))
    const app = buildMindmapSubgraph({ provider, loaders: { docx: docxLoader } }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'docx', path: '/tmp/report.docx' },
        mindmapInputTitle: 'Office Root',
      }),
    )

    expect(docxLoader).toHaveBeenCalledWith({ type: 'docx', path: '/tmp/report.docx' })
    expect(result.error).toBe('')
    expect(result.documentRef).toEqual(
      expect.objectContaining({
        type: 'docx',
        source: '/tmp/report.docx',
        filename: 'report.docx',
      }),
    )
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
        batchIndex: 99,
        leafResults: [{ batchIndex: 0, batchId: 'stale-batch', tree: { label: 'Stale Leaf' } }],
        mergeInputs: [{ label: 'Stale Merge Input' }],
        mergeGroup: { groupIndex: 0, trees: [{ label: 'Stale Group' }] },
        mergeResults: [{ groupIndex: 0, tree: { label: 'Stale Merge' } }],
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

  it('extracts all leaf batches before any merge starts', async () => {
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
    // two-phase map-reduce: all 9 leaves finish before the first merge,
    // then round 1 (8+1 → 2 merges) and round 2 (2 → 1 merge) converge
    expect(events.filter((e) => e === 'leaf')).toHaveLength(9)
    expect(events.filter((e) => e === 'merge')).toHaveLength(3)
    expect(events.indexOf('merge')).toBeGreaterThan(events.lastIndexOf('leaf'))
  })
})

describe('mindmapGraph wave concurrency', () => {
  /** n paragraphs of ~1900 chars each; with a 512-token window each becomes its own batch. */
  function manyBatchText(n: number): string {
    return Array.from({ length: n }, (_, i) => `p${i}${'w'.repeat(1898)}`).join('\n\n')
  }

  /** Leaf output embeds the paragraph marker (pN) so call sites stay identifiable. */
  function identifiableLeafProvider(onInvoke?: (messages: Array<{ content: string }>) => void) {
    return mockProvider((messages) => {
      onInvoke?.(messages)
      const systemPrompt = messages[0]?.content ?? ''
      if (systemPrompt.includes('merging assistant')) {
        return { content: 'Merged Root:\n  - Combined\n' }
      }
      const marker = /p(\d+)/.exec(messages[1]?.content ?? '')?.[1] ?? 'x'
      return { content: `Root p${marker}:\n  - item${marker}\n` }
    }, 512)
  }

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  it('caps concurrent in-flight model calls at 4', async () => {
    let inFlight = 0
    let peak = 0
    const provider = identifiableLeafProvider()
    invokeMock(provider).mockImplementation(async (messages: Array<{ content: string }>) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 10))
        const systemPrompt = messages[0]?.content ?? ''
        if (systemPrompt.includes('merging assistant')) {
          return { content: 'Merged Root:\n  - Combined\n' }
        }
        const marker = /p(\d+)/.exec(messages[1]?.content ?? '')?.[1] ?? 'x'
        return { content: `Root p${marker}:\n  - item${marker}\n` }
      } finally {
        inFlight -= 1
      }
    })
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: manyBatchText(10) },
        mindmapInputTitle: 'Concurrent Doc',
      }),
      { recursionLimit: 100 },
    )

    expect(result.error).toBe('')
    expect(result.leafResults).toHaveLength(10)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('keeps document order in the merge prompt even when batches finish out of order', async () => {
    const slow = deferred<{ content: string }>()
    const provider = mockProvider((messages) => {
      const user = messages[1]?.content ?? ''
      if (user.includes('p0')) return slow.promise // batch 0 finishes last
      const marker = /p(\d+)/.exec(user)?.[1]
      if (marker) return { content: `Root p${marker}:\n  - item${marker}\n` }
      return { content: 'Merged Root:\n  - Combined\n' }
    }, 512)
    const app = buildMindmapSubgraph({ provider }).compile()

    const resultPromise = app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: manyBatchText(4) },
        mindmapInputTitle: 'Out Of Order Doc',
      }),
      { recursionLimit: 100 },
    )

    // let batches 1-3 complete, then release batch 0
    await vi.waitFor(() => expect(invokeMock(provider)).toHaveBeenCalledTimes(4))
    slow.resolve({ content: 'Root p0:\n  - item0\n' })
    const result = await resultPromise

    expect(result.error).toBe('')
    const mergeCall = invokeMock(provider).mock.calls.find((call) =>
      String(call[0]?.[0]?.content ?? '').includes('merging assistant'),
    )
    const mergePrompt = String(mergeCall?.[0]?.[1]?.content ?? '')
    const p0 = mergePrompt.indexOf('Root p0')
    const p1 = mergePrompt.indexOf('Root p1')
    const p2 = mergePrompt.indexOf('Root p2')
    const p3 = mergePrompt.indexOf('Root p3')
    expect(p0).toBeGreaterThanOrEqual(0)
    expect(p0).toBeLessThan(p1)
    expect(p1).toBeLessThan(p2)
    expect(p2).toBeLessThan(p3)
  })

  it('fails the whole run fast when one batch keeps rejecting and dispatches no further waves', async () => {
    const provider = mockProvider((messages) => {
      const user = messages[1]?.content ?? ''
      if (user.includes('p1')) return Promise.reject(new Error('boom p1'))
      const marker = /p(\d+)/.exec(user)?.[1] ?? 'x'
      return { content: `Root p${marker}:\n  - item${marker}\n` }
    }, 512)
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: manyBatchText(6) },
        mindmapInputTitle: 'Failing Doc',
      }),
      { recursionLimit: 100 },
    )

    expect(result.error).toContain('boom p1')
    expect(result.mindmapYaml).toBe('')
    // only the first wave (batches 0-3) ran; batches 4-5 were never dispatched
    expect(invokeMock(provider)).toHaveBeenCalledTimes(4)
  })

  it('merges in grouped waves and converges over multiple rounds', async () => {
    const mergePrompts: string[] = []
    const provider = identifiableLeafProvider((messages) => {
      if ((messages[0]?.content ?? '').includes('merging assistant')) {
        mergePrompts.push(messages[1]?.content ?? '')
      }
    })
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: manyBatchText(9) },
        mindmapInputTitle: 'Huge Doc',
      }),
      { recursionLimit: 100 },
    )

    expect(result.error).toBe('')
    expect(result.leafResults).toHaveLength(9)
    // round 1: 9 trees → groups of 8 + 1; round 2: 2 trees → 1 group
    expect(mergePrompts).toHaveLength(3)
    expect(mergePrompts[0]).toContain('--- Tree 8 ---')
    expect(mergePrompts[1]).toContain('--- Tree 1 ---')
    expect(mergePrompts[1]).not.toContain('--- Tree 2 ---')
    expect(mergePrompts[2]).toContain('--- Tree 2 ---')
    expect(result.mindmapYaml).toContain('Merged Root')
  })

  it('emits quantified progress events with the step enum unchanged', async () => {
    const provider = identifiableLeafProvider()
    const app = buildMindmapSubgraph({ provider }).compile()

    const events: Array<{ step: string; completed?: number; total?: number }> = []
    const stream = await app.stream(
      baseInput({
        mindmapInputSource: { type: 'text', content: manyBatchText(3) },
        mindmapInputTitle: 'Progress Doc',
      }),
      { streamMode: 'custom', recursionLimit: 100 },
    )
    for await (const event of stream) {
      events.push(event as { step: string; completed?: number; total?: number })
    }

    expect(events[0]?.step).toBe('reading-doc')
    expect(events.at(-1)?.step).toBe('finalizing')

    // phase-start events carry no counts; per-item events carry completed/total
    const extracting = events.filter((e) => e.step === 'extracting')
    const extractingItems = extracting.filter((e) => e.completed !== undefined)
    expect(extracting).toHaveLength(4)
    expect(extracting[0]?.completed).toBeUndefined()
    expect(extractingItems.map((e) => e.completed).sort()).toEqual([1, 2, 3])
    expect(extractingItems.every((e) => e.total === 3)).toBe(true)

    const merging = events.filter((e) => e.step === 'merging')
    expect(merging).toHaveLength(2)
    expect(merging[0]?.completed).toBeUndefined()
    expect(merging[1]).toMatchObject({ completed: 1, total: 1 })
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
