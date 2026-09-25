import { describe, it, expect, vi } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { AgentOrchestrator } from '../orchestrator.js'
import type { AgentServices } from '../service.js'
import { ProviderCapability, type LLMProvider } from '../providers/index.js'
import { AGENT_LIMITS } from '../config.js'
import { StreamManager } from '../streamManager.js'
import type { SessionManager } from '../context/sessionManager.js'
import type { ChatStreamEvent } from '../../ipc.js'

const TREE_XML = '<node>读书笔记\n  <node>第一点</node>\n</node>'

/**
 * Scripted provider for a whole AI-triggered run: the supervisor asks for the
 * mindmap subgraph, the subgraph's own model calls return a valid outline, the
 * supervisor answers after the ToolMessage. The macrotask yield stand-in for a
 * real provider is deliberate: the run must not be a single microtask-only
 * blast, or LangChain's callback dispatch starves and the tail of the stream
 * (including the subgraph ToolMessage) never reaches the caller.
 */
function scriptedProvider(contextWindow = 32_768): LLMProvider {
  const invoke = vi.fn(async (messages: BaseMessage[]) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const last = messages[messages.length - 1]
    if (last?.type === 'human') {
      return new AIMessage({
        content: '我来生成思维导图',
        tool_calls: [
          { name: 'generateMindmapFragment', args: {}, id: 'call-mm', type: 'tool_call' },
        ],
      })
    }
    if (last?.type === 'tool') return new AIMessage({ content: '导图已完成' })
    return new AIMessage({ content: TREE_XML })
  })

  return {
    model: {
      invoke,
      bindTools: () => ({ invoke }),
      withStructuredOutput: () => ({ invoke }),
    },
    contextWindow,
    capabilities: new Set([ProviderCapability.Chat]),
    models: [],
  } as unknown as LLMProvider
}

/** Subgraph-side model calls always answer with unusable XML → the mindmap run fails. */
function failingMindmapProvider(): LLMProvider {
  const invoke = vi.fn(async (messages: BaseMessage[]) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const last = messages[messages.length - 1]
    if (last?.type === 'human') {
      return new AIMessage({
        content: '我来生成思维导图',
        tool_calls: [
          { name: 'generateMindmapFragment', args: {}, id: 'call-mm', type: 'tool_call' },
        ],
      })
    }
    return new AIMessage({ content: '这不是 XML' })
  })
  return {
    model: { invoke, bindTools: () => ({ invoke }), withStructuredOutput: () => ({ invoke }) },
    contextWindow: 32_768,
    capabilities: new Set([ProviderCapability.Chat]),
    models: [],
  } as unknown as LLMProvider
}

/** ~1900-char paragraphs: with a small context window each one becomes a leaf batch. */
function manyBatchText(batches: number): string {
  return Array.from({ length: batches }, (_, i) => `p${i}${'w'.repeat(1898)}`).join('\n\n')
}

interface Harness {
  manager: StreamManager
  orchestrator: AgentOrchestrator
  events: ChatStreamEvent[]
  persisted: Map<string, BaseMessage[]>
  savedUserMessages: BaseMessage[]
}

function createHarness(provider: LLMProvider, withCheckpointer = true): Harness {
  const persisted = new Map<string, BaseMessage[]>()
  const savedUserMessages: BaseMessage[] = []
  const sessionManager = {
    workspaceUuid: 'workspace-a',
    isReady: () => true,
    runInWorkspace: (_workspaceUuid: string, action: () => unknown) => action(),
    getSessionMeta: () => undefined,
    loadSessionMessages: async () => [],
    loadSessionBaseMessages: async (sessionId: string) => [...(persisted.get(sessionId) ?? [])],
    saveMessage: async (sessionId: string, message: BaseMessage) => {
      savedUserMessages.push(message)
      persisted.set(sessionId, [...(persisted.get(sessionId) ?? []), message])
    },
    saveMessages: async (sessionId: string, messages: BaseMessage[]) => {
      persisted.set(sessionId, [...(persisted.get(sessionId) ?? []), ...messages])
    },
  }
  const orchestrator = new AgentOrchestrator(
    provider,
    {
      checkpointer: { getAdapter: () => (withCheckpointer ? new MemorySaver() : undefined) },
      sessionManager,
    } as unknown as AgentServices,
    // Read-only mindmap access for the mixed tool + subgraph round.
    { mindmapReadProvider: async () => '<node id="root">root</node>' },
  )
  const events: ChatStreamEvent[] = []
  const manager = new StreamManager({
    sessionManager: sessionManager as unknown as SessionManager,
    eventSink: (event) => events.push(event),
    createRuntime: () => orchestrator.getStreamRuntime(),
  })

  return { manager, orchestrator, events, persisted, savedUserMessages }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 200; attempts += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('condition not reached')
}

function findToolMessage(messages: BaseMessage[] | undefined): ToolMessage | undefined {
  return messages?.find((message): message is ToolMessage => message.type === 'tool')
}

function toolMessages(messages: BaseMessage[] | undefined): ToolMessage[] {
  return (messages ?? []).filter((message): message is ToolMessage => message.type === 'tool')
}

const PALACE_PLAN_JSON = JSON.stringify({
  theme: '测试宫殿',
  scene_brief: '一间测试大厅',
  route_style: 'arc',
  stations: [
    {
      order: 1,
      linked_node_id: 'n1',
      content: '第一站',
      anchor_visual: '巨大的铜钟',
      visual_bridge: '钟声让人想起这一站',
    },
  ],
})

const SVG_ARTIFACT =
  '{"stations":[{"order":1,"x":0.25,"y":0.4}]}\n<svg viewBox="0 0 1000 1000"><g data-station="1"><circle cx="250" cy="400" r="20"/></g></svg>'

/**
 * One scripted provider for a round that declares several calls at once.
 *
 * Supervisor calls go through `bindTools`; both subgraphs call the plain model,
 * so their replies are keyed on the prompt that reached them (the two subgraphs
 * run concurrently and interleave, so call order cannot identify them).
 */
function multiCallProvider(
  declared: Array<{ name: string; id: string; args?: Record<string, unknown> }>,
  finalText = '都做完了',
): LLMProvider {
  const supervisorInvoke = vi.fn(async (messages: BaseMessage[]) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const last = messages[messages.length - 1]
    if (last?.type === 'tool') return new AIMessage({ content: finalText })
    return new AIMessage({
      content: '一次做完',
      tool_calls: declared.map((call) => ({
        ...call,
        args: call.args ?? {},
        type: 'tool_call' as const,
      })),
    })
  })
  const subgraphInvoke = vi.fn(async (messages: BaseMessage[]) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const last = messages[messages.length - 1] as { content?: unknown } | undefined
    const prompt = typeof last?.content === 'string' ? last.content : ''
    if (prompt.includes('Extract a mindmap outline')) return new AIMessage({ content: TREE_XML })
    if (prompt.includes('请为以下')) return new AIMessage({ content: PALACE_PLAN_JSON })
    if (prompt.includes('主题：')) return new AIMessage({ content: SVG_ARTIFACT })
    throw new Error(`unexpected subgraph prompt: ${prompt.slice(0, 120)}`)
  })

  return {
    model: {
      invoke: subgraphInvoke,
      bindTools: () => ({ invoke: supervisorInvoke }),
      withStructuredOutput: () => ({ invoke: subgraphInvoke }),
    },
    contextWindow: 32_768,
    capabilities: new Set([ProviderCapability.Chat]),
    models: [],
  } as unknown as LLMProvider
}

describe('主图以节点形式挂载两个子图', () => {
  it('AI 触发的导图生成：流事件序列与 ToolMessage 与改动前等价', async () => {
    const harness = createHarness(scriptedProvider())
    const sessionId = 'session-as-node'
    const request = {
      sessionId,
      message: '把这段内容做成导图',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a', filePath: '/a.mindlane', fileTitle: '读书笔记' },
    }

    const streamId = harness.manager.startStream(request)
    await waitUntil(() => harness.manager.getActiveStreamCount() === 0)

    const steps = harness.events
      .filter((event) => event.type === 'step')
      .map((event) => (event as { payload: unknown }).payload)
    const toolStarts = harness.events
      .filter((event) => event.type === 'tool-start')
      .map((event) => (event as { payload: unknown }).payload)
    const toolEnds = harness.events
      .filter((event) => event.type === 'tool-end')
      .map((event) => (event as { payload: unknown }).payload)

    // Stage trace: the same custom-progress channel, in order, with counts;
    // the owning call id rides along so parallel subgraphs can be told apart.
    expect(steps).toEqual([
      { step: 'reading-doc', callId: 'call-mm' },
      { step: 'extracting', callId: 'call-mm' },
      { step: 'extracting', completed: 1, total: 1, callId: 'call-mm' },
      { step: 'finalizing', callId: 'call-mm' },
    ])
    // One subgraph card: anchored by the first progress step, closed by the ToolMessage.
    expect(toolStarts).toEqual([{ id: 'call-mm', name: 'generateMindmapFragment', input: {} }])
    expect(toolEnds).toEqual([
      {
        id: 'call-mm',
        name: 'generateMindmapFragment',
        status: 'success',
        output: expect.stringContaining('"ok":true'),
      },
    ])
    expect(harness.events.map((event) => event.type)).toContain('end')
    expect(harness.events.every((event) => event.streamId === streamId)).toBe(true)

    // The subgraph's own close-out ToolMessage is what the session keeps.
    const toolMessage = findToolMessage(harness.persisted.get(sessionId))
    expect(toolMessage).toBeDefined()
    expect(toolMessage!.name).toBe('generateMindmapFragment')
    expect(toolMessage!.tool_call_id).toBe('call-mm')
    expect(JSON.parse(String(toolMessage!.content))).toMatchObject({
      ok: true,
      title: '读书笔记',
    })
    expect(toolMessage!.additional_kwargs.toolSteps).toEqual([
      { step: 'reading-doc' },
      { step: 'extracting' },
      { step: 'extracting', completed: 1, total: 1 },
      { step: 'finalizing' },
    ])
  })

  it('子图失败时只收口一次：一条错误 ToolMessage，然后结束而不是重新进子图', async () => {
    const harness = createHarness(failingMindmapProvider())
    const sessionId = 'session-as-node-failed'

    harness.manager.startStream({
      sessionId,
      message: '把这段内容做成导图',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a', filePath: '/a.mindlane', fileTitle: '读书笔记' },
    })
    await waitUntil(() => harness.manager.getActiveStreamCount() === 0)

    // `pendingSubgraphs` is cleared by the supervisor on every non-subgraph path;
    // if it were left set, the graph would re-enter the subgraph node forever.
    const toolEnds = harness.events.filter((event) => event.type === 'tool-end')
    expect(toolEnds).toHaveLength(1)
    expect(toolEnds[0]).toMatchObject({ payload: { id: 'call-mm', status: 'error' } })
    const toolMessages = harness.persisted
      .get(sessionId)
      ?.filter((message) => message.type === 'tool')
    expect(toolMessages).toHaveLength(1)
    expect(JSON.parse(String(toolMessages![0].content))).toMatchObject({ ok: false })
    expect(harness.events.map((event) => event.type)).toContain('end')
  })

  it('长文档（多波 leaf + 归并）在共享预算内跑完，旧的 80 步预算不够', async () => {
    const batches = 150
    const runOnce = async (recursionLimit: number): Promise<ToolMessage | undefined> => {
      const harness = createHarness(scriptedProvider(512), false)
      const runtime = harness.orchestrator.getStreamRuntime()
      const stream = await runtime.graph.stream(
        {
          messages: [new HumanMessage(manyBatchText(batches))],
          context: { fileUuid: 'file-a', filePath: '/a.mindlane', fileTitle: '长文档' },
          artworkStyle: 'vector',
        },
        { recursionLimit, streamMode: ['messages'] },
      )
      let toolMessage: ToolMessage | undefined
      for await (const [mode, payload] of stream) {
        if (mode !== 'messages') continue
        const [message] = payload as [BaseMessage]
        if (message.type === 'tool') toolMessage = message as ToolMessage
      }
      return toolMessage
    }

    // Subgraph super-steps count against the host graph's budget (S9a): the
    // pre-change 80 would die mid-wave, which is why AGENT_LIMITS was retuned.
    await expect(runOnce(80)).rejects.toThrow(/recursion/i)

    const toolMessage = await runOnce(AGENT_LIMITS.recursionLimit)

    expect(toolMessage).toBeDefined()
    expect(JSON.parse(String(toolMessage!.content))).toMatchObject({ ok: true })
  }, 60_000)

  it('一轮里的两个子图调用都执行：两条 ToolMessage，阶段进度各归各的调用', async () => {
    const harness = createHarness(
      multiCallProvider([
        { name: 'generateMindmapFragment', id: 'call-mm' },
        { name: 'generatePalace', id: 'call-pl' },
      ]),
    )
    const sessionId = 'session-two-subgraphs'

    harness.manager.startStream({
      sessionId,
      message: '把文档做成导图，再给选中的节点建个宫殿',
      workspaceUuid: 'workspace-a',
      context: {
        fileUuid: 'file-a',
        filePath: '/a.mindlane',
        fileTitle: '读书笔记',
        selectedNodes: [{ id: 'n1', type: 'text', label: '第一站' }],
      },
    })
    await waitUntil(() => harness.manager.getActiveStreamCount() === 0)

    const payloads = (type: ChatStreamEvent['type']) =>
      harness.events
        .filter((event) => event.type === type)
        .map((event) => event.payload as Record<string, unknown>)

    // Each subgraph's progress is attributed to its own call, so the renderer's
    // cards cannot cross wires the way the old "first pending call" did.
    const stepsFor = (callId: string) =>
      payloads('step')
        .filter((payload) => payload.callId === callId)
        .map((payload) =>
          Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'callId')),
        )
    expect(stepsFor('call-mm')).toEqual([
      { step: 'reading-doc' },
      { step: 'extracting' },
      { step: 'extracting', completed: 1, total: 1 },
      { step: 'finalizing' },
    ])
    expect(stepsFor('call-pl')).toEqual([
      { step: 'planning-stations' },
      { step: 'generating-image' },
    ])

    const starts = payloads('tool-start').map((payload) => payload.id as string)
    const ends = payloads('tool-end').map((payload) => `${payload.id}:${payload.status}`)
    expect([...starts].sort()).toEqual(['call-mm', 'call-pl'])
    expect([...ends].sort()).toEqual(['call-mm:success', 'call-pl:success'])
    // Both cards are declared before either closes out: the two subgraphs were
    // in the same super-step, not queued one after the other.
    const lastStart = harness.events.findLastIndex((event) => event.type === 'tool-start')
    const firstEnd = harness.events.findIndex((event) => event.type === 'tool-end')
    expect(lastStart).toBeLessThan(firstEnd)

    const messages = toolMessages(harness.persisted.get(sessionId))
    expect(messages.map((message) => `${message.tool_call_id}:${message.name}`).sort()).toEqual([
      'call-mm:generateMindmapFragment',
      'call-pl:generatePalace',
    ])
    const palaceMessage = messages.find((message) => message.tool_call_id === 'call-pl')!
    expect(JSON.parse(String(palaceMessage.content))).toMatchObject({
      ok: true,
      imageUrl: expect.stringMatching(/^data:image\/svg\+xml/),
      sourceNodeIds: ['n1'],
    })
    expect(palaceMessage.additional_kwargs.toolSteps).toEqual([
      { step: 'planning-stations' },
      { step: 'generating-image' },
    ])
    const mindmapMessage = messages.find((message) => message.tool_call_id === 'call-mm')!
    expect(JSON.parse(String(mindmapMessage.content))).toMatchObject({
      ok: true,
      title: '读书笔记',
    })
    expect(harness.events.map((event) => event.type)).toContain('end')
  })

  it('普通工具与子图混合声明时两者都执行', async () => {
    const harness = createHarness(
      multiCallProvider([
        { name: 'readMindmap', id: 'call-read' },
        { name: 'generateMindmapFragment', id: 'call-mm' },
      ]),
    )
    const sessionId = 'session-tool-plus-subgraph'

    harness.manager.startStream({
      sessionId,
      message: '先读图定位，再按文档建图',
      workspaceUuid: 'workspace-a',
      context: { fileUuid: 'file-a', filePath: '/a.mindlane', fileTitle: '读书笔记' },
    })
    await waitUntil(() => harness.manager.getActiveStreamCount() === 0)

    const messages = toolMessages(harness.persisted.get(sessionId))
    expect(messages.map((message) => `${message.tool_call_id}:${message.name}`).sort()).toEqual([
      'call-mm:generateMindmapFragment',
      'call-read:readMindmap',
    ])
    // The plain tool went through ToolNode (its real result, not an error
    // ToolMessage saying the virtual tool was not found).
    const readMessage = messages.find((message) => message.tool_call_id === 'call-read')!
    expect(JSON.parse(String(readMessage.content))).toMatchObject({
      ok: true,
      summary: expect.stringContaining('<node id="root">'),
    })
    expect(
      JSON.parse(String(messages.find((m) => m.tool_call_id === 'call-mm')!.content)),
    ).toMatchObject({ ok: true })

    const startIds = harness.events
      .filter((event) => event.type === 'tool-start')
      .map((event) => (event.payload as { id: string }).id)
    expect([...startIds].sort()).toEqual(['call-mm', 'call-read'])
  })
})
