import { describe, it, expect, vi } from 'vitest'
import { ToolMessage } from '@langchain/core/messages'
import { buildPalacePayload, buildPalaceSubgraph } from './palaceGraph.js'
import { ProviderCapability, type LLMProvider } from '../providers/index.js'
import type { ChatContext } from '../../ipc.js'
import { GENERATE_PALACE_TOOL } from '../tools/subgraphRoutingTools.js'
import { applyCanonicalLayout } from '../agenthub/palaceLayout.js'
import type { MindmapWrite } from '../../../contracts/mindmapDocument/writeAction.js'
import type { StationDesign, PalaceSubgraphStateType } from '../state.js'

// The subgraph nodes key their per-run bookkeeping by the Runner's run context
// and throw without one (the `(no-stream)` fallback key is gone). These unit
// tests drive the subgraph directly, so they pin a run id here; the
// run-context requirement itself is covered by the run-contract seam test.
vi.mock('../../shared/runContext.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/runContext.js')>()),
  currentStreamId: () => 'stream_test',
  requireStreamId: () => 'stream_test',
}))

const SVG_REPLY = '<svg viewBox="0 0 1000 1000"><circle cx="250" cy="400" r="20"/></svg>'

/** One selected-node plan: three stations on a zigzag route. */
const PLAN = JSON.stringify({
  theme: 'Test Palace',
  scene_brief: 'A test hall with three landmarks',
  route_style: 'zigzag',
  stations: [
    {
      order: 1,
      content: 'First station',
      anchor_visual: 'A giant bronze bell',
      linked_node_id: 'n1',
    },
    {
      order: 2,
      content: 'Second station',
      anchor_visual: 'A crystal chandelier',
      linked_node_id: 'n2',
    },
    {
      order: 3,
      content: 'Third station',
      anchor_visual: 'A stone staircase',
      linked_node_id: 'n3',
    },
  ],
})

const PLANNED_STATIONS: StationDesign[] = [
  {
    order: 1,
    content: 'First station',
    anchorVisual: 'A giant bronze bell',
    mnemonicMethod: 'Visual association',
    association: '',
    linkedNodeId: 'n1',
  },
  {
    order: 2,
    content: 'Second station',
    anchorVisual: 'A crystal chandelier',
    mnemonicMethod: 'Visual association',
    association: '',
    linkedNodeId: 'n2',
  },
  {
    order: 3,
    content: 'Third station',
    anchorVisual: 'A stone staircase',
    mnemonicMethod: 'Visual association',
    association: '',
    linkedNodeId: 'n3',
  },
]

/** The single coordinate producer's output for the plan above. */
const CANONICAL_ROUTE = applyCanonicalLayout(PLANNED_STATIONS, 'zigzag')

const CONTEXT = {
  fileUuid: 'file-a',
  selectedNodes: [
    { id: 'n1', type: 'text' as const, label: 'First station' },
    { id: 'n2', type: 'text' as const, label: 'Second station' },
    { id: 'n3', type: 'text' as const, label: 'Third station' },
  ],
} satisfies ChatContext

function createMockProvider(
  capabilities: ReadonlySet<ProviderCapability> = new Set([ProviderCapability.Chat]),
): LLMProvider {
  const model = {
    invoke: vi.fn(),
    bindTools: vi.fn().mockReturnValue({ invoke: vi.fn() }),
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: vi.fn() }),
  }
  return {
    model,
    // A vision slot may exist, but the palace must never call it.
    visionModel: { invoke: vi.fn() },
    capabilities,
    models: [],
    generateImage: vi.fn(),
  } as unknown as LLMProvider
}

/** Provider whose planning succeeds and whose following artwork call is scripted. */
function scriptedProvider(options: {
  capabilities?: ReadonlySet<ProviderCapability>
  artwork?: () => Promise<{ content: string }>
}): { provider: LLMProvider; modelInvoke: ReturnType<typeof vi.fn> } {
  const provider = createMockProvider(options.capabilities)
  const modelInvoke = provider.model.invoke as unknown as ReturnType<typeof vi.fn>
  modelInvoke.mockResolvedValueOnce({ content: PLAN })
  if (options.artwork) modelInvoke.mockImplementationOnce(options.artwork)
  return { provider, modelInvoke }
}

interface RunOptions {
  provider: LLMProvider
  artworkStyle?: 'vector' | 'raster'
  write?: MindmapWrite
}

async function runPalace(options: RunOptions) {
  const graph = buildPalaceSubgraph({
    provider: options.provider,
    write: options.write,
  }).compile()

  const steps: string[] = []
  let result!: PalaceSubgraphStateType
  const stream = await graph.stream(
    {
      messages: [],
      artworkStyle: options.artworkStyle ?? 'vector',
      context: CONTEXT,
      palaceToolCallId: 'call-palace',
      palaceToolName: GENERATE_PALACE_TOOL,
    },
    { streamMode: ['custom', 'values'] },
  )

  for await (const [mode, event] of stream) {
    if (mode === 'custom') steps.push((event as { step: string }).step)
    if (mode === 'values') result = event as PalaceSubgraphStateType
  }
  return { steps, result }
}

const locations = (route: Array<{ order: number; x: number; y: number }>) =>
  route.map(({ order, x, y }) => ({ order, x, y }))

describe('buildPalaceSubgraph', () => {
  it('emits exactly the planning and artwork stages: visual localization is gone', async () => {
    const { provider } = scriptedProvider({ artwork: async () => ({ content: SVG_REPLY }) })

    const { steps, result } = await runPalace({ provider })

    expect(steps).toEqual(['planning-stations', 'generating-image'])
    expect(result.palaceToolSteps).toEqual([
      { step: 'planning-stations' },
      { step: 'generating-image' },
    ])
  })

  it('always takes station coordinates from the canonical layout, whatever the artwork did', async () => {
    const expected = locations(CANONICAL_ROUTE)

    // Vector carrier with a drawn artwork.
    const vector = await runPalace({
      provider: scriptedProvider({ artwork: async () => ({ content: SVG_REPLY }) }).provider,
    })
    expect(vector.result.imageUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(locations(vector.result.memoryRoute)).toEqual(expected)

    // Bitmap carrier with a generated background.
    const raster = scriptedProvider({
      capabilities: new Set([ProviderCapability.Chat, ProviderCapability.ImageGen]),
    })
    ;(raster.provider.generateImage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      urls: ['data:image/png;base64,iVBORw0KGgo='],
    })
    const bitmap = await runPalace({
      provider: raster.provider,
      artworkStyle: 'raster',
    })
    expect(bitmap.result.imageUrl).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(locations(bitmap.result.memoryRoute)).toEqual(expected)

    // No artwork at all: the coordinates are identical.
    const failed = await runPalace({
      provider: scriptedProvider({
        artwork: async () => {
          throw new Error('drawing service unavailable')
        },
      }).provider,
    })
    expect(failed.result.imageUrl).toBeUndefined()
    expect(locations(failed.result.memoryRoute)).toEqual(expected)

    // A raster preference without an image model still draws (resolver fallback).
    expect(locations(vector.result.memoryRoute)).toEqual(locations(bitmap.result.memoryRoute))
  })

  it('treats an unparseable artwork reply as "no artwork" and lands anyway', async () => {
    const { provider } = scriptedProvider({
      artwork: async () => ({ content: 'Sorry, I cannot draw that.' }),
    })
    const write = vi.fn<MindmapWrite>(async () => ({ ok: true, action: 'landPalace', data: {} }))

    const { result } = await runPalace({ provider, write })

    expect(result.palaceError).toBe('')
    expect(result.imageUrl).toBeUndefined()
    expect(result.memoryRoute).toHaveLength(3)
    expect(write).toHaveBeenCalledTimes(1)
    const xml = (write.mock.calls[0] as unknown as [string, string, { xml: string }])[2].xml
    expect(xml).toContain('type="palace"')
    expect(xml).not.toContain('imageUrl')
    expect(xml).toContain('<station order="1"')
    expect(xml).toContain('sourceNodeIds="n1,n2,n3"')
  })

  it('never asks the vision model for anything: vision capability is not part of palace behavior', async () => {
    const { provider } = scriptedProvider({
      capabilities: new Set([ProviderCapability.Chat, ProviderCapability.Vision]),
      artwork: async () => ({ content: SVG_REPLY }),
    })

    const { result } = await runPalace({ provider })

    expect(provider.visionModel?.invoke).not.toHaveBeenCalled()
    expect(result.palaceError).toBe('')
    expect(result.memoryRoute).toHaveLength(3)
  })

  it('works with a text-only provider: a palace lands with stations and no artwork', async () => {
    const { provider } = scriptedProvider({
      artwork: async () => {
        throw new Error('the drawing call failed')
      },
    })
    const write = vi.fn<MindmapWrite>(async () => ({ ok: true, action: 'landPalace', data: {} }))

    const { result } = await runPalace({ provider, write })

    expect(result.palaceError).toBe('')
    expect(result.memoryRoute).toHaveLength(3)
    const [fileUuid, action, args] = write.mock.calls[0] as unknown as [
      string,
      string,
      { xml: string },
    ]
    expect(fileUuid).toBe('file-a')
    expect(action).toBe('landPalace')
    expect(args.xml).not.toContain('imageUrl')
  })

  it('close-out ToolMessage carries the call info, landing request, canonical coordinates and stage trace', async () => {
    // A data URL keeps the run off the network and mirrors the persisted shape.
    const imageUrl = 'data:image/png;base64,iVBORw0KGgo='
    const { provider } = scriptedProvider({
      capabilities: new Set([ProviderCapability.Chat, ProviderCapability.ImageGen]),
    })
    ;(provider.generateImage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      urls: [imageUrl],
    })
    const write = vi.fn<MindmapWrite>(async () => ({ ok: true, action: 'landPalace', data: {} }))

    const { result } = await runPalace({ provider, artworkStyle: 'raster', write })

    // Deterministic landing: the payload is serialized to XML by code and lands
    // through the shared write action; the image data URL rides the request, not
    // the model context.
    expect(write).toHaveBeenCalledTimes(1)
    const [fileUuid, action, args] = write.mock.calls[0] as unknown as [
      string,
      string,
      { xml: string },
    ]
    expect(fileUuid).toBe('file-a')
    expect(action).toBe('landPalace')
    expect(args.xml).toContain('<node id=')
    expect(args.xml).toContain('type="palace"')
    expect(args.xml).toContain(`imageUrl="${imageUrl}"`)
    expect(args.xml).toContain('sourceNodeIds="n1,n2,n3"')
    for (const station of CANONICAL_ROUTE) {
      expect(args.xml).toContain(
        `<station order="${station.order}" x="${station.x}" y="${station.y}" linkedNodeId="${station.linkedNodeId}"`,
      )
    }

    expect(result.messages).toHaveLength(1)
    const toolMessage = result.messages[0] as ToolMessage
    expect(toolMessage.tool_call_id).toBe('call-palace')
    expect(toolMessage.name).toBe(GENERATE_PALACE_TOOL)
    const modelPayload = JSON.parse(String(toolMessage.content)) as Record<string, unknown>
    expect(modelPayload).toEqual({
      ok: true,
      landed: true,
      label: 'Test Palace',
      stations: CANONICAL_ROUTE.map((station) => ({
        order: station.order,
        content: station.content,
        anchorVisual: station.anchorVisual,
        association: station.association,
        x: station.x,
        y: station.y,
        linkedNodeId: station.linkedNodeId,
      })),
      sourceNodeIds: ['n1', 'n2', 'n3'],
    })
    // The artwork data URL never enters the model context.
    expect(JSON.stringify(modelPayload)).not.toContain('imageUrl')
    expect(toolMessage.additional_kwargs.toolSteps).toEqual([
      { step: 'planning-stations' },
      { step: 'generating-image' },
    ])
  })

  it('writes the reason into the ToolMessage and the landing error channel when the landing request fails', async () => {
    const { provider } = scriptedProvider({ artwork: async () => ({ content: SVG_REPLY }) })
    const write = vi.fn<MindmapWrite>(async () => ({
      ok: false,
      error: 'File is not open, cannot land',
    }))

    const { result } = await runPalace({ provider, write })

    expect(result.palaceLandingError).toBe('File is not open, cannot land')
    const toolMessage = result.messages[0] as ToolMessage
    expect(JSON.parse(String(toolMessage.content))).toEqual({
      ok: false,
      error: 'Memory palace generated, but landing failed: File is not open, cannot land',
    })
  })

  it('publishes no artwork field at all when the palace has no image', () => {
    const payload = buildPalacePayload({
      palaceError: '',
      palaceResponse: '',
      palaceLandingError: '',
      palace: { theme: 'Test Palace' },
      memoryRoute: CANONICAL_ROUTE,
      imageUrl: undefined,
      palaceInputNodes: [{ id: 'n1' }],
    })

    expect(payload).toMatchObject({ ok: true, label: 'Test Palace', sourceNodeIds: ['n1'] })
    expect(payload).not.toHaveProperty('imageUrl')
  })

  it('ends with palaceError and calls no model when there is no input', async () => {
    const provider = createMockProvider()

    const result = await buildPalaceSubgraph({ provider })
      .compile()
      .invoke({ messages: [], artworkStyle: 'vector', context: null })

    expect(result.palaceError).toContain('Provide input content for the memory palace')
    expect(provider.model.invoke).not.toHaveBeenCalled()
  })

  it('clears the previous run palaceResponse at the start of a new run: a failure never reports the old response', async () => {
    const provider = createMockProvider()
    ;(provider.model.invoke as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('plan failed'),
    )

    const result = await buildPalaceSubgraph({ provider }).compile().invoke({
      messages: [],
      artworkStyle: 'vector',
      context: CONTEXT,
      palaceResponse: 'Summary of the memory palace generated in the previous run',
    })

    expect(result.palaceError).toContain('plan failed')
    expect(result.palaceResponse).toBe('')
    expect(result.palaceToolSteps).toEqual([{ step: 'planning-stations' }])
  })
})
