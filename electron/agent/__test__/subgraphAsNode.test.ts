import { describe, it, expect, vi } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { AgentOrchestrator } from '../orchestrator.js'
import type { AgentServices } from '../service.js'
import { ProviderCapability, type LLMProvider } from '../providers/index.js'
import { AGENT_LIMITS } from '../config.js'
import { runWithRunContext } from '../../shared/runContext.js'
import { StreamManager } from '../streamManager.js'
import type { SessionManager } from '../context/sessionManager.js'
import type { ChatStreamEvent } from '../../ipc.js'

const TREE_XML = '<node>Reading notes\n  <node>First point</node>\n</node>'

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
        content: 'Generating the mindmap now',
        tool_calls: [
          { name: 'generateMindmapFragment', args: {}, id: 'call-mm', type: 'tool_call' },
        ],
      })
    }
    if (last?.type === 'tool') return new AIMessage({ content: 'Mindmap is done' })
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
        content: 'Generating the mindmap now',
        tool_calls: [
          { name: 'generateMindmapFragment', args: {}, id: 'call-mm', type: 'tool_call' },
        ],
      })
    }
    return new AIMessage({ content: 'This is not XML' })
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

interface WriteRequestRecord {
  fileUuid: string
  action: string
  args: Record<string, unknown>
}

interface Harness {
  manager: StreamManager
  orchestrator: AgentOrchestrator
  events: ChatStreamEvent[]
  persisted: Map<string, BaseMessage[]>
  savedUserMessages: BaseMessage[]
  /** Palace landing requests the run emitted through the fake write proxy. */
  writeRequests: WriteRequestRecord[]
}

function createHarness(provider: LLMProvider, withCheckpointer = true): Harness {
  const persisted = new Map<string, BaseMessage[]>()
  const savedUserMessages: BaseMessage[] = []
  const sessionManager = {
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
  const writeRequests: WriteRequestRecord[] = []
  const orchestrator = new AgentOrchestrator(
    provider,
    {
      checkpointer: { getAdapter: () => (withCheckpointer ? new MemorySaver() : undefined) },
      sessionManager,
    } as unknown as AgentServices,
    {
      // Read-only mindmap access for the mixed tool + subgraph round.
      mindmapReadProvider: async () => '<node id="root">root</node>',
      // Fake landing proxy: records what each run asks the renderer to land.
      mindmapWriteProxy: async (fileUuid, action, args) => {
        writeRequests.push({ fileUuid, action, args })
        return { ok: true, action, data: { nodeId: 'landed-palace' } }
      },
    },
  )
  const events: ChatStreamEvent[] = []
  const manager = new StreamManager({
    sessionManager: sessionManager as unknown as SessionManager,
    eventSink: (event) => events.push(event),
    createRuntime: () => orchestrator.getStreamRuntime(),
  })

  return { manager, orchestrator, events, persisted, savedUserMessages, writeRequests }
}

/**
 * Ids of streams that reached their terminal event: one `end` per finished run,
 * or `error` when the runtime never started.
 */
function settledStreamIds(events: ReadonlyArray<{ streamId: string; type: string }>): string[] {
  return events
    .filter((event) => event.type === 'end' || event.type === 'error')
    .map((event) => event.streamId)
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
  theme: 'Test palace',
  scene_brief: 'a test hall',
  route_style: 'arc',
  stations: [
    {
      order: 1,
      linked_node_id: 'n1',
      content: 'First station',
      anchor_visual: 'giant bronze bell',
      visual_bridge: 'the bell rings and recalls this station',
    },
  ],
})

const SVG_ARTIFACT =
  '{"stations":[{"order":1,"x":0.25,"y":0.4}]}\n<svg viewBox="0 0 1000 1000"><g data-station="1"><circle cx="250" cy="400" r="20"/></g></svg>'

/**
 * Scripted provider for the manual palace run: the palace subgraph's two model
 * calls (plan → artwork) are keyed on their prompts, and any supervisor call is
 * a contract violation — the palace entry must not ask the model to route.
 */
function palaceRunProvider(options: { blockArtwork?: boolean } = {}) {
  let releaseArtwork: () => void = () => undefined
  const artworkGate = new Promise<void>((resolve) => {
    releaseArtwork = resolve
  })
  const invoke = vi.fn(async (messages: BaseMessage[]) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const last = messages[messages.length - 1] as { content?: unknown } | undefined
    const prompt = typeof last?.content === 'string' ? last.content : ''
    if (prompt.includes('Design a memory palace route'))
      return new AIMessage({ content: PALACE_PLAN_JSON })
    if (prompt.includes('Theme:')) {
      if (options.blockArtwork) await artworkGate
      return new AIMessage({ content: SVG_ARTIFACT })
    }
    throw new Error(`unexpected palace prompt: ${prompt.slice(0, 120)}`)
  })
  const supervisorInvoke = vi.fn(async () => {
    throw new Error('palace entry must not run the supervisor')
  })

  return {
    provider: {
      model: {
        invoke,
        bindTools: () => ({ invoke: supervisorInvoke }),
        withStructuredOutput: () => ({ invoke }),
      },
      contextWindow: 32_768,
      capabilities: new Set([ProviderCapability.Chat]),
      models: [],
    } as unknown as LLMProvider,
    /** Model calls whose last message carries the marker (plan vs artwork). */
    calls: (marker: string) =>
      invoke.mock.calls.filter(([messages]) => {
        const last = messages[messages.length - 1] as { content?: unknown } | undefined
        return typeof last?.content === 'string' && last.content.includes(marker)
      }).length,
    releaseArtwork,
  }
}

/**
 * Manual palace generation is one ephemeral graph run (CONTEXT.md "Ephemeral Run"):
 * the request carries the entry marker, START goes straight to the palace
 * subgraph, nothing reaches a session, and the run's `end` carries the landing
 * payload exactly once.
 */
describe('Manual palace: one ephemeral run', () => {
  const palaceRequest = (sessionId: string, privateThreadId: string, resume = false) => ({
    sessionId,
    message: '',
    workspaceUuid: 'workspace-a',
    context: {
      fileUuid: 'file-a',
      workspacePath: '/workspace/test',
      filePath: '/a.mindlane',
      fileTitle: 'Reading notes',
      selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
    },
    ephemeral: { privateThreadId, runEntry: 'palace' as const, ...(resume ? { resume } : {}) },
  })

  it('runs no model turns, writes no session, emits stage progress, and ends with a single landing payload', async () => {
    const scripted = palaceRunProvider()
    const harness = createHarness(scripted.provider)

    harness.manager.startStream(palaceRequest('palace-run-1', 'palace-thread-1'))
    await waitUntil(() => settledStreamIds(harness.events).length === 1)

    // Stage progress flows like any other run (same channel, same vocabulary).
    // The manual run answers no virtual tool call, so no callId rides along and
    // no tool card is declared — its progress belongs to the palace node.
    const steps = harness.events
      .filter((event) => event.type === 'step')
      .map((event) => event.payload)
    expect(steps).toEqual([{ step: 'planning-stations' }, { step: 'generating-image' }])
    expect(
      harness.events.filter((event) => event.type === 'tool-start' || event.type === 'tool-end'),
    ).toEqual([])

    // The model was asked to plan and to draw — never to route (no compaction,
    // no supervisor): two subgraph calls, zero supervisor turns.
    expect(scripted.calls('Design a memory palace route')).toBe(1)
    expect(scripted.calls('Theme:')).toBe(1)

    // Zero session writes: no history read, no user message, no result.
    expect(harness.savedUserMessages).toEqual([])
    expect(harness.persisted.size).toBe(0)

    // Deterministic landing: exactly one palace write request, carrying the
    // code-serialized XML (the image data URL rides the request, not the model).
    const palaceWrites = harness.writeRequests.filter((request) => request.action === 'landPalace')
    expect(palaceWrites).toHaveLength(1)
    expect(palaceWrites[0]).toMatchObject({ fileUuid: 'file-a' })
    expect(Object.keys(palaceWrites[0]!.args)).toEqual(['xml'])
    expect(String(palaceWrites[0]!.args.xml)).toContain('type="palace"')
    expect(String(palaceWrites[0]!.args.xml)).toContain('imageUrl="data:image/svg+xml')
    expect(String(palaceWrites[0]!.args.xml)).toContain('sourceNodeIds="n1"')

    const ends = harness.events.filter((event) => event.type === 'end')
    const landingPayloads = ends.filter(
      (event) => (event.payload as { palaceData?: unknown }).palaceData,
    )
    expect(landingPayloads).toHaveLength(1)
    expect((landingPayloads[0]!.payload as { palaceData: unknown }).palaceData).toMatchObject({
      ok: true,
      label: 'Test palace',
      sourceNodeIds: ['n1'],
      imageUrl: expect.stringMatching(/^data:image\/svg\+xml/),
    })
  })

  it('both trigger paths emit palace write requests of the same shape (one landing code path)', async () => {
    // Manual trigger: one ephemeral entry run, same scripted palace stages.
    const manual = createHarness(palaceRunProvider().provider)
    manual.manager.startStream(palaceRequest('palace-shape-manual', 'palace-thread-shape'))
    await waitUntil(() => settledStreamIds(manual.events).length === 1)

    // AI trigger: the supervisor declares generatePalace, the same subgraph runs.
    const ai = createHarness(multiCallProvider([{ name: 'generatePalace', id: 'call-pl' }]))
    ai.manager.startStream({
      sessionId: 'session-shape-ai',
      message: 'build a palace for the selected nodes',
      workspaceUuid: 'workspace-a',
      context: {
        fileUuid: 'file-a',
        workspacePath: '/workspace/test',
        filePath: '/a.mindlane',
        fileTitle: 'Reading notes',
        selectedNodes: [{ id: 'n1', type: 'text', label: 'First station' }],
      },
    })
    await waitUntil(() => settledStreamIds(ai.events).length === 1)

    const [manualRequest] = manual.writeRequests
    const [aiRequest] = ai.writeRequests
    expect(manualRequest?.action).toBe('landPalace')
    expect(aiRequest?.action).toBe('landPalace')
    expect(manualRequest?.fileUuid).toBe('file-a')
    expect(aiRequest?.fileUuid).toBe('file-a')
    expect(Object.keys(manualRequest!.args)).toEqual(['xml'])
    expect(Object.keys(aiRequest!.args)).toEqual(['xml'])
    // One serializer: the two fragments differ only in the minted node id.
    const withoutMintedId = (xml: string) => xml.replace(/ id="[^"]+"/, '')
    expect(withoutMintedId(String(aiRequest!.args.xml))).toBe(
      withoutMintedId(String(manualRequest!.args.xml)),
    )
  })

  it('resuming with empty input on the same thread after an abort: completed super-steps do not re-run and the landing still finishes on the same payload', async () => {
    const scripted = palaceRunProvider({ blockArtwork: true })
    const harness = createHarness(scripted.provider)

    // Run 1: stop while the artwork stage is in flight — the plan super-step has
    // already completed and is checkpointed on the private thread.
    const firstStreamId = harness.manager.startStream(
      palaceRequest('palace-run-2', 'palace-thread-2'),
    )
    await waitUntil(() =>
      harness.events.some(
        (event) =>
          event.type === 'step' && (event.payload as { step?: string }).step === 'generating-image',
      ),
    )
    expect(scripted.calls('Design a memory palace route')).toBe(1)
    harness.manager.stopStream(firstStreamId)
    scripted.releaseArtwork()
    await waitUntil(() => settledStreamIds(harness.events).length === 1)
    // A stopped run lands nothing: no palace payload on its end event.
    expect(
      harness.events
        .filter((event) => event.type === 'end')
        .every((event) => !(event.payload as { palaceData?: unknown }).palaceData),
    ).toBe(true)

    // Resume: same private thread, empty input.
    harness.manager.startStream(palaceRequest('palace-run-3', 'palace-thread-2', true))
    await waitUntil(() => settledStreamIds(harness.events).length === 2)

    // The completed stage did not re-run (one plan call across both runs), the
    // interrupted one did, and the resumed run still lands.
    expect(scripted.calls('Design a memory palace route')).toBe(1)
    expect(scripted.calls('Theme:')).toBe(2)
    const ends = harness.events.filter(
      (event) => event.type === 'end' && (event.payload as { palaceData?: unknown }).palaceData,
    )
    expect(ends).toHaveLength(1)
    expect((ends[0]!.payload as { palaceData: unknown }).palaceData).toMatchObject({
      ok: true,
      sourceNodeIds: ['n1'],
    })
    expect(harness.persisted.size).toBe(0)
  })

  it('the subgraph fails loudly when there is no run context (the fallback key has been removed)', async () => {
    const { provider } = palaceRunProvider()
    const orchestrator = new AgentOrchestrator(provider, {
      checkpointer: { getAdapter: () => new MemorySaver() },
      sessionManager: {},
    } as unknown as AgentServices)
    const graph = orchestrator.getStreamRuntime().graph

    // No Runner wrapped this stream, so there is no run context to key the
    // subgraph's per-run bookkeeping — that must fail loudly, not share a bucket.
    const runWithoutContext = async () => {
      const stream = await graph.stream(
        {
          runEntry: 'palace',
          context: {
            fileUuid: 'file-a',
            selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
          },
          artworkStyle: 'vector' as const,
        },
        { streamMode: ['custom'] },
      )
      for await (const chunk of stream) {
        void chunk // drain to the failure
      }
    }
    await expect(runWithoutContext()).rejects.toThrow(/run context/)
  })
})

/**
 * One scripted provider for a round that declares several calls at once.
 *
 * Supervisor calls go through `bindTools`; both subgraphs call the plain model,
 * so their replies are keyed on the prompt that reached them (the two subgraphs
 * run concurrently and interleave, so call order cannot identify them).
 */
function multiCallProvider(
  declared: Array<{ name: string; id: string; args?: Record<string, unknown> }>,
  finalText = 'All done',
): LLMProvider {
  const supervisorInvoke = vi.fn(async (messages: BaseMessage[]) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const last = messages[messages.length - 1]
    if (last?.type === 'tool') return new AIMessage({ content: finalText })
    return new AIMessage({
      content: 'Doing both at once',
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
    if (prompt.includes('Design a memory palace route'))
      return new AIMessage({ content: PALACE_PLAN_JSON })
    if (prompt.includes('Theme:')) return new AIMessage({ content: SVG_ARTIFACT })
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

describe('The main graph mounts both subgraphs as nodes', () => {
  it('AI-triggered mindmap generation: stream event sequence and ToolMessage match the pre-change behaviour', async () => {
    const harness = createHarness(scriptedProvider())
    const sessionId = 'session-as-node'
    const request = {
      sessionId,
      message: 'turn this content into a mindmap',
      workspaceUuid: 'workspace-a',
      context: {
        fileUuid: 'file-a',
        workspacePath: '/workspace/test',
        filePath: '/a.mindlane',
        fileTitle: 'Reading notes',
      },
    }

    const streamId = harness.manager.startStream(request)
    await waitUntil(() => settledStreamIds(harness.events).length === 1)

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
      title: 'Reading notes',
    })
    expect(toolMessage!.additional_kwargs.toolSteps).toEqual([
      { step: 'reading-doc' },
      { step: 'extracting' },
      { step: 'extracting', completed: 1, total: 1 },
      { step: 'finalizing' },
    ])
  })

  it('a failing subgraph closes out once: one error ToolMessage, then the run ends instead of re-entering the subgraph', async () => {
    const harness = createHarness(failingMindmapProvider())
    const sessionId = 'session-as-node-failed'

    harness.manager.startStream({
      sessionId,
      message: 'turn this content into a mindmap',
      workspaceUuid: 'workspace-a',
      context: {
        fileUuid: 'file-a',
        workspacePath: '/workspace/test',
        filePath: '/a.mindlane',
        fileTitle: 'Reading notes',
      },
    })
    await waitUntil(() => settledStreamIds(harness.events).length === 1)

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

  it('a long document (several leaf waves + merge) finishes within the shared budget; the old 80-step budget was not enough', async () => {
    const batches = 150
    const runOnce = (recursionLimit: number): Promise<ToolMessage | undefined> =>
      // The run context is what the subgraph keys its waves by: the direct-graph
      // test plays the Runner's part.
      runWithRunContext(
        {
          streamId: 'stream-test',
          sessionId: 'session-long-doc',
          workspace: { path: '/workspace/test', uuid: 'workspace-a' },
        },
        async () => {
          const harness = createHarness(scriptedProvider(512), false)
          const runtime = harness.orchestrator.getStreamRuntime()
          const stream = await runtime.graph.stream(
            {
              messages: [new HumanMessage(manyBatchText(batches))],
              context: {
                fileUuid: 'file-a',
                workspacePath: '/workspace/test',
                filePath: '/a.mindlane',
                fileTitle: 'Long document',
              },
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
        },
      )

    // Subgraph super-steps count against the host graph's budget (S9a): the
    // pre-change 80 would die mid-wave, which is why AGENT_LIMITS was retuned.
    await expect(runOnce(80)).rejects.toThrow(/recursion/i)

    const toolMessage = await runOnce(AGENT_LIMITS.recursionLimit)

    expect(toolMessage).toBeDefined()
    expect(JSON.parse(String(toolMessage!.content))).toMatchObject({ ok: true })
  }, 60_000)

  it('both subgraph calls in one round execute: two ToolMessages, each call gets its own stage progress', async () => {
    const harness = createHarness(
      multiCallProvider([
        { name: 'generateMindmapFragment', id: 'call-mm' },
        { name: 'generatePalace', id: 'call-pl' },
      ]),
    )
    const sessionId = 'session-two-subgraphs'

    harness.manager.startStream({
      sessionId,
      message: 'turn the document into a mindmap, then build a palace for the selected nodes',
      workspaceUuid: 'workspace-a',
      context: {
        fileUuid: 'file-a',
        workspacePath: '/workspace/test',
        filePath: '/a.mindlane',
        fileTitle: 'Reading notes',
        selectedNodes: [{ id: 'n1', type: 'text', label: 'First station' }],
      },
    })
    await waitUntil(() => settledStreamIds(harness.events).length === 1)

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
    // The model reads a landed palace summary, never the artwork data URL: the
    // landing already went to the renderer through the write request.
    expect(JSON.parse(String(palaceMessage.content))).toMatchObject({
      ok: true,
      landed: true,
      sourceNodeIds: ['n1'],
    })
    expect(String(palaceMessage.content)).not.toContain('data:image')
    expect(palaceMessage.additional_kwargs.toolSteps).toEqual([
      { step: 'planning-stations' },
      { step: 'generating-image' },
    ])
    const mindmapMessage = messages.find((message) => message.tool_call_id === 'call-mm')!
    expect(JSON.parse(String(mindmapMessage.content))).toMatchObject({
      ok: true,
      title: 'Reading notes',
    })
    expect(harness.events.map((event) => event.type)).toContain('end')
  })

  it('a plain tool and a subgraph declared together both execute', async () => {
    const harness = createHarness(
      multiCallProvider([
        { name: 'readMindmap', id: 'call-read' },
        { name: 'generateMindmapFragment', id: 'call-mm' },
      ]),
    )
    const sessionId = 'session-tool-plus-subgraph'

    harness.manager.startStream({
      sessionId,
      message: 'read the mindmap first to orient, then build one from the document',
      workspaceUuid: 'workspace-a',
      context: {
        fileUuid: 'file-a',
        workspacePath: '/workspace/test',
        filePath: '/a.mindlane',
        fileTitle: 'Reading notes',
      },
    })
    await waitUntil(() => settledStreamIds(harness.events).length === 1)

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
