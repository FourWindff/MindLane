import { describe, it, expect, vi } from 'vitest'
import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import { Document } from '@langchain/core/documents'
import { buildMindmapSubgraph } from '../index.js'
import type { LLMProvider } from '../../../providers/index.js'
import { MindmapSubgraphState } from '../../../state.js'

type InvokeMock = ReturnType<typeof vi.fn>

function mockProvider(
  impl?: (messages: Array<{ content: string }>) => unknown,
  contextWindow = 32_768,
) {
  return {
    model: {
      invoke: impl ? vi.fn(impl) : vi.fn(),
    },
    contextWindow,
  } as unknown as LLMProvider
}

function invokeMock(provider: LLMProvider): InvokeMock {
  return provider.model.invoke as unknown as InvokeMock
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
    toolSteps: [],
    ...overrides,
  }
}

const VALID_TREE_XML = `<node>人工智能导论
  <node>机器学习
    <node>监督学习</node>
    <node>无监督学习</node>
  </node>
  <node>深度学习
    <node>神经网络</node>
    <node>反向传播</node>
  </node>
</node>`

/** Invalid XML: unclosed tag → xml_parse_error with position. */
const INVALID_TREE_XML = '<node>Root\n  <node>Child</node>'

describe('mindmapGraph', () => {
  it('returns error when no input source is provided', async () => {
    const provider = mockProvider()
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(baseInput({ mindmapInputSource: null }))

    expect(result.error).toContain('请提供要生成思维导图的文档或文本')
    expect(invokeMock(provider)).not.toHaveBeenCalled()
  })

  it('precomputes documentBatches in the load node', async () => {
    const provider = mockProvider(() => ({ content: VALID_TREE_XML }))
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
    const provider = mockProvider(() => ({ content: VALID_TREE_XML }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: '这是一篇关于人工智能的文档。' },
        mindmapInputTitle: '人工智能导论',
      }),
    )

    expect(result.error).toBe('')
    expect(result.mindmapXml).toContain('人工智能导论')
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
    const provider = mockProvider(() => ({
      content: '<node>Short Document\n  <node>Summary</node>\n</node>',
    }))
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

  it('collects the stage trace into result.toolSteps (same source as step events)', async () => {
    const tail = 'TAIL_MARKER'
    const para1 = 'a'.repeat(1500)
    const para2 = 'b'.repeat(1500)
    const para3 = `${'c'.repeat(1490)}${tail}`
    const longText = [para1, para2, para3].join('\n\n')
    const provider = mockProvider((messages) => {
      const systemPrompt = messages[0]?.content ?? ''
      if (systemPrompt.includes('merging assistant')) {
        return { content: '<node>Merged Long Text\n  <node>Preserved Tail</node>\n</node>' }
      }
      return { content: '<node>Leaf Tree\n  <node>Extracted</node>\n</node>' }
    }, 512)
    const app = buildMindmapSubgraph({ provider }).compile()

    let result!: typeof MindmapSubgraphState.State
    const stream = await app.stream(
      baseInput({
        mindmapInputSource: { type: 'text', content: longText },
        mindmapInputTitle: 'Long Text',
      }),
      { streamMode: ['custom', 'values'] },
    )

    for await (const [mode, event] of stream) {
      if (mode === 'values') result = event as typeof MindmapSubgraphState.State
    }

    expect(result.error).toBe('')
    expect(result.toolSteps[0]).toEqual({ step: 'reading-doc' })
    // one phase-start entry plus one per completed batch
    expect(result.toolSteps.filter((s) => s.step === 'extracting')).toHaveLength(4)
    expect(result.toolSteps.some((s) => s.step === 'merging')).toBe(true)
    expect(result.toolSteps.at(-1)).toEqual({ step: 'finalizing' })
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
        return { content: '<node>Merged Long Text\n  <node>Preserved Tail</node>\n</node>' }
      }
      return { content: '<node>Leaf Tree\n  <node>Extracted</node>\n</node>' }
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
    expect(result.mindmapXml).toContain('Merged Long Text')
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
    const leafXml = '<node>Tree\n  <node>X</node>\n</node>'
    const smallWindow = mockProvider(() => ({ content: leafXml }), 512)
    const largeWindow = mockProvider(() => ({ content: leafXml }), 128_000)

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
    const provider = mockProvider(() => ({
      content: '<node>URL Root\n  <node>Loaded URL text</node>\n</node>',
    }))
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
    expect(result.mindmapXml).toContain('URL Root')
    expect(result.documentRef?.type).toBe('url')
    expect(invokeMock(provider)).toHaveBeenCalledTimes(1)
  })

  it('records file-backed document metadata through an injected office loader', async () => {
    const docxLoader = vi.fn().mockResolvedValue([new Document({ pageContent: 'Office text' })])
    const provider = mockProvider(() => ({
      content: '<node>Office Root\n  <node>Office text</node>\n</node>',
    }))
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
    const provider = mockProvider(() => ({
      content: '<node>Fresh Root\n  <node>Fresh Child</node>\n</node>',
    }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        response: 'stale response',
        error: 'stale error',
        mindmapInputSource: { type: 'text', content: 'fresh text' },
        mindmapInputTitle: 'Fresh Root',
        mindmapXml: 'Stale Root:\n  - Stale Child\n',
        mindmapTitle: 'Stale Root',
        documentBatches: [[new Document({ pageContent: 'stale text' })]],
        batchIndex: 99,
        leafResults: [
          { batchIndex: 0, batchId: 'stale-batch', tree: { label: 'Stale Leaf', children: [] } },
        ],
        mergeInputs: [{ label: 'Stale Merge Input', children: [] }],
        mergeGroup: { groupIndex: 0, trees: [{ label: 'Stale Group', children: [] }] },
        mergeResults: [{ groupIndex: 0, tree: { label: 'Stale Merge', children: [] } }],
        finalTree: { label: 'Stale Final', children: [] },
      }),
    )

    expect(result.error).toBe('')
    expect(result.mindmapXml).toContain('Fresh Root')
    expect(result.mindmapXml).not.toContain('Stale Root')
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

  it('retries leaf extraction when generated XML is invalid', async () => {
    const provider = mockProvider()
    invokeMock(provider)
      .mockResolvedValueOnce({ content: INVALID_TREE_XML })
      .mockResolvedValueOnce({ content: VALID_TREE_XML })
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: '这是一篇关于人工智能的文档。' },
        mindmapInputTitle: '人工智能导论',
      }),
    )

    expect(result.error).toBe('')
    expect(result.mindmapXml).toContain('人工智能导论')
    expect(invokeMock(provider)).toHaveBeenCalledTimes(2)
  })

  it('returns an error after repeated invalid XML output', async () => {
    const provider = mockProvider(() => ({ content: INVALID_TREE_XML }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({ mindmapInputSource: { type: 'text', content: 'some document text' } }),
    )

    expect(result.error).toContain('XML 校验失败：[xml_parse_error]')
    expect(result.error).toContain('标签 <node> 未闭合')
    expect(result.mindmapXml).toBe('')
    expect(invokeMock(provider)).toHaveBeenCalledTimes(3)
  })

  it('retries merge before storing merge results', async () => {
    const longText = ['a'.repeat(1500), 'b'.repeat(1500)].join('\n\n')
    // small window puts each paragraph in its own batch
    const provider = mockProvider(undefined, 512)
    invokeMock(provider)
      .mockResolvedValueOnce({ content: '<node>Leaf A\n  <node>Child A</node>\n</node>' })
      .mockResolvedValueOnce({ content: '<node>Leaf B\n  <node>Child B</node>\n</node>' })
      .mockResolvedValueOnce({ content: INVALID_TREE_XML })
      .mockResolvedValueOnce({
        content: '<node>Merged Root\n  <node>Child A</node>\n  <node>Child B</node>\n</node>',
      })
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
    expect(result.mindmapXml).toContain('Merged Root')
    expect(invokeMock(provider)).toHaveBeenCalledTimes(4)
  })

  it('wraps a multi-root leaf output in a synthetic batch root', async () => {
    const provider = mockProvider(() => ({
      content: '<node>Part A\n  <node>A1</node>\n</node>\n<node>Part B\n  <node>B1</node>\n</node>',
    }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: 'some document text' },
        mindmapInputTitle: 'AI 导论',
      }),
    )

    expect(result.error).toBe('')
    expect(result.mindmapXml).toContain('content="Batch 1"')
    expect(result.mindmapXml).toContain('content="Part A"')
    expect(result.mindmapXml).toContain('content="Part B"')
    // 合成根 label 与旧 YAML 行为一致：包合成根的 label 成为标题
    expect(result.mindmapTitle).toBe('Batch 1')
  })

  it('keeps special characters complete and escaped in the output fragment', async () => {
    const provider = mockProvider(() => ({
      content:
        '<node>R&amp;D &lt;fast&gt;\n  <node>a &gt; b &amp; c</node>\n  <node>价格 100%</node>\n</node>',
    }))
    const app = buildMindmapSubgraph({ provider }).compile()

    const result = await app.invoke(
      baseInput({
        mindmapInputSource: { type: 'text', content: 'some document text' },
        mindmapInputTitle: 'Special Doc',
      }),
    )

    expect(result.error).toBe('')
    expect(result.mindmapXml).toContain('content="R&amp;D &lt;fast&gt;"')
    expect(result.mindmapXml).toContain('content="a &gt; b &amp; c"')
    expect(result.mindmapXml).toContain('content="价格 100%"')
    expect(result.mindmapXml).not.toContain('<node>R&D') // 模型原串不外泄
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
        return { content: `<node>Merged ${events.length}\n  <node>Combined</node>\n</node>` }
      }
      events.push('leaf')
      return { content: `<node>Leaf ${events.length}\n  <node>Extracted</node>\n</node>` }
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

describe('mindmapGraph writer propagation', () => {
  it('surfaces subgraph progress events through a nested invoke from an outer stream', async () => {
    // 断点：外层 stream + 节点内嵌套 invoke 子图 → 进度事件必须能冒出。
    // langgraph 的 pickRunnableConfigKeys 不透传 custom writer，orchestrator 的
    // invokeSubgraph 经 configurable.writer 显式传播；本用例是修复的唯一验证点。
    const provider = mockProvider(() => ({ content: VALID_TREE_XML }))
    const app = buildMindmapSubgraph({ provider }).compile()

    // 最小外层图：节点内以 orchestrator 的方式嵌套 invoke 编译后的子图。
    const S = Annotation.Root({
      v: Annotation<number>({ reducer: (_prev: number, next: number) => next, default: () => 0 }),
    })
    const outer = new StateGraph(S)
      .addNode('sub', async (state) => {
        await app.invoke(
          baseInput({
            mindmapInputSource: { type: 'text', content: '这是一篇关于人工智能的文档。' },
            mindmapInputTitle: '人工智能导论',
          }),
          { recursionLimit: 25, callbacks: [] },
        )
        return { v: state.v + 1 }
      })
      .addEdge(START, 'sub')
      .addEdge('sub', END)
      .compile()

    const steps: string[] = []
    const stream = await outer.stream(
      { v: 0 },
      { streamMode: ['custom', 'values'], configurable: { thread_id: 't1' } },
    )
    for await (const [mode, payload] of stream) {
      if (mode === 'custom') steps.push((payload as { step: string }).step)
    }

    expect(steps).toContain('reading-doc')
    expect(steps).toContain('extracting')
    expect(steps).toContain('finalizing')
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
        return { content: '<node>Merged Root\n  <node>Combined</node>\n</node>' }
      }
      const marker = /p(\d+)/.exec(messages[1]?.content ?? '')?.[1] ?? 'x'
      return { content: `<node>Root p${marker}\n  <node>item${marker}</node>\n</node>` }
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
          return { content: '<node>Merged Root\n  <node>Combined</node>\n</node>' }
        }
        const marker = /p(\d+)/.exec(messages[1]?.content ?? '')?.[1] ?? 'x'
        return { content: `<node>Root p${marker}\n  <node>item${marker}</node>\n</node>` }
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
      if (marker) {
        return { content: `<node>Root p${marker}\n  <node>item${marker}</node>\n</node>` }
      }
      return { content: '<node>Merged Root\n  <node>Combined</node>\n</node>' }
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
    slow.resolve({ content: '<node>Root p0\n  <node>item0</node>\n</node>' })
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
      return { content: `<node>Root p${marker}\n  <node>item${marker}</node>\n</node>` }
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
    expect(result.mindmapXml).toBe('')
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
    // merge input is model-dialect XML, one <node> root per tree
    expect(mergePrompts[0]).toContain('<node>Root p1')
    expect(mergePrompts[0]).not.toContain('content="')
    expect(result.mindmapXml).toContain('Merged Root')
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
