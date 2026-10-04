import { describe, it, expect, vi } from 'vitest'
import { ToolMessage } from '@langchain/core/messages'
import { buildPalaceSubgraph } from '../palaceGraph.js'
import { ProviderCapability, type LLMProvider } from '../../providers/index.js'
import type { ChatContext } from '../../../ipc.js'
import { resolveArtworkStyle } from '../../../../contracts/palaceArtworkStyle.js'
import { GENERATE_PALACE_TOOL } from '../../tools/subgraphRoutingTools.js'

// The subgraph nodes key their per-run bookkeeping by the Runner's run context
// and throw without one (the `(no-stream)` fallback key is gone). These unit
// tests drive the subgraph directly, so they pin a run id here; the
// run-context requirement itself is covered by the run-contract seam test.
vi.mock('../../../shared/runContext.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/runContext.js')>()),
  currentStreamId: () => 'stream_test',
  requireStreamId: () => 'stream_test',
}))

function createMockProvider(): LLMProvider {
  return {
    model: {
      invoke: vi.fn(),
      bindTools: vi.fn().mockReturnValue({ invoke: vi.fn() }),
      withStructuredOutput: vi.fn().mockReturnValue({ invoke: vi.fn() }),
    },
    visionModel: {
      invoke: vi.fn(),
      bindTools: vi.fn().mockReturnValue({ invoke: vi.fn() }),
      withStructuredOutput: vi.fn().mockReturnValue({ invoke: vi.fn() }),
    },
    capabilities: new Set([
      ProviderCapability.Chat,
      ProviderCapability.ImageGen,
      ProviderCapability.Vision,
    ]),
    models: [],
    generateImage: vi.fn().mockResolvedValue({ urls: ['https://example.com/image.png'] }),
  } as unknown as LLMProvider
}

/** Provider good enough for the whole palace pipeline: plan → image → locate → summary. */
function createStageProvider(): LLMProvider {
  const provider = createMockProvider() as unknown as {
    model: { invoke: ReturnType<typeof vi.fn> }
    visionModel: { invoke: ReturnType<typeof vi.fn> }
  }
  provider.model.invoke = vi.fn(async () => ({
    content: JSON.stringify({
      theme: 'Test Palace',
      scene_brief: 'A test hall',
      route_style: 'arc',
      stations: [
        {
          order: 1,
          content: 'First station',
          anchor_visual: 'A giant bronze bell',
          linked_node_id: 'n1',
        },
      ],
    }),
  }))
  provider.visionModel.invoke = vi.fn(async () => ({
    content: JSON.stringify([{ order: 1, x: 0.25, y: 0.4 }]),
  }))
  return provider as unknown as LLMProvider
}

describe('buildPalaceSubgraph', () => {
  it('includes the normalizeImages node', () => {
    const graph = buildPalaceSubgraph({ provider: createMockProvider() })

    expect(Object.keys(graph.nodes)).toContain('normalizeImages')
  })

  it('routes imageGen -> normalizeImages -> vision', () => {
    const graph = buildPalaceSubgraph({ provider: createMockProvider() })

    const edges = Array.from(graph.edges as unknown as Array<[string, string]>)
    expect(edges).toContainEqual(['imageGen', 'normalizeImages'])
    expect(edges).toContainEqual(['normalizeImages', 'vision'])
  })

  it('streams the palace stages in order and collects them into palaceToolSteps', async () => {
    const graph = buildPalaceSubgraph({ provider: createStageProvider() }).compile()

    const steps: string[] = []
    let result!: { palaceToolSteps: Array<{ step: string }> }
    const stream = await graph.stream(
      {
        messages: [],
        artworkStyle: 'raster',
        // Selected nodes take the analyze path that returns one JSON plan.
        context: {
          fileUuid: 'file-a',
          selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
        } satisfies ChatContext,
        // A previous subgraph run's trace must be reset, not appended to.
        palaceToolSteps: [{ step: 'extracting' }],
      },
      { streamMode: ['custom', 'values'] },
    )

    for await (const [mode, event] of stream) {
      if (mode === 'custom') steps.push((event as { step: string }).step)
      if (mode === 'values') result = event as typeof result
    }

    expect(steps).toEqual(['planning-stations', 'generating-image', 'locating-stations'])
    // The persisted trace is the same source as the emitted events.
    expect(result.palaceToolSteps).toEqual([
      { step: 'planning-stations' },
      { step: 'generating-image' },
      { step: 'locating-stations' },
    ])
  })

  it('uses the vector path by default and returns the model coordinates and SVG data URL', async () => {
    const provider = createMockProvider() as unknown as {
      model: { invoke: ReturnType<typeof vi.fn> }
    }
    provider.model.invoke = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          theme: 'Test Palace',
          scene_brief: 'A test hall',
          route_style: 'arc',
          stations: [
            {
              order: 1,
              content: 'First station',
              anchor_visual: 'A giant bronze bell',
              linked_node_id: 'n1',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content:
          '{"stations":[{"order":1,"x":0.25,"y":0.4}]}\n<svg viewBox="0 0 1000 1000"><g data-station="1"><circle cx="250" cy="400" r="20"/></g></svg>',
      })

    const graph = buildPalaceSubgraph({ provider: provider as unknown as LLMProvider }).compile()
    const steps: string[] = []
    let result!: { imageUrls: string[]; memoryRoute: Array<{ x: number; y: number }> }
    const stream = await graph.stream(
      {
        messages: [],
        artworkStyle: 'vector',
        context: {
          fileUuid: 'file-a',
          selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
        } satisfies ChatContext,
      },
      { streamMode: ['custom', 'values'] },
    )

    for await (const [mode, event] of stream) {
      if (mode === 'custom') steps.push((event as { step: string }).step)
      if (mode === 'values') result = event as typeof result
    }

    expect(steps).toEqual(['planning-stations', 'generating-image'])
    expect(result.imageUrls[0]).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(result.memoryRoute[0]).toMatchObject({ x: 0.25, y: 0.4 })
  })

  it('falls back to the canonical route when vector coordinates are invalid', async () => {
    const provider = createMockProvider() as unknown as {
      model: { invoke: ReturnType<typeof vi.fn> }
    }
    provider.model.invoke = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          theme: 'Test Palace',
          stations: [
            {
              order: 1,
              content: 'First station',
              anchor_visual: 'A giant bronze bell',
              linked_node_id: 'n1',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content:
          '{"stations":[{"order":1,"x":2,"y":0.4}]}\n<svg viewBox="0 0 1000 1000"><g data-station="1"/></svg>',
      })

    const graph = buildPalaceSubgraph({ provider: provider as unknown as LLMProvider }).compile()
    const result = await graph.invoke({
      messages: [],
      artworkStyle: 'vector',
      context: {
        fileUuid: 'file-a',
        selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
      } satisfies ChatContext,
    })

    expect(result.memoryRoute[0]?.x).toBeCloseTo(0.5)
    expect(result.memoryRoute[0]?.y).toBeCloseTo(0.62)
    expect(result.imageUrls[0]).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('drops invalid SVG artwork while keeping a successful route', async () => {
    const provider = createMockProvider() as unknown as {
      model: { invoke: ReturnType<typeof vi.fn> }
    }
    provider.model.invoke = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          theme: 'Test Palace',
          stations: [
            {
              order: 1,
              content: 'First station',
              anchor_visual: 'A giant bronze bell',
              linked_node_id: 'n1',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        content: '{"stations":[{"order":1,"x":0.25,"y":0.4}]}\n<svg><g data-station="1"/></svg>',
      })

    const result = await buildPalaceSubgraph({
      provider: provider as unknown as LLMProvider,
    })
      .compile()
      .invoke({
        messages: [],
        artworkStyle: 'vector',
        context: {
          fileUuid: 'file-a',
          selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
        } satisfies ChatContext,
      })

    expect(result.palaceError).toBe('')
    expect(result.imageUrls).toEqual([])
    expect(result.memoryRoute[0]).toMatchObject({ x: 0.25, y: 0.4 })
  })

  it('resolves raster preference only when image generation is available', () => {
    expect(resolveArtworkStyle('raster', new Set([ProviderCapability.ImageGen]))).toBe('raster')
    expect(resolveArtworkStyle('raster', new Set())).toBe('vector')
    expect(resolveArtworkStyle('vector', new Set([ProviderCapability.ImageGen]))).toBe('vector')
    expect(resolveArtworkStyle('vector', new Set())).toBe('vector')
  })

  it('ends with palaceError and calls no model when there is no input', async () => {
    const provider = createMockProvider()

    const result = await buildPalaceSubgraph({ provider })
      .compile()
      .invoke({ messages: [], artworkStyle: 'vector', context: null })

    expect(result.palaceError).toContain('Provide input content for the memory palace')
    expect(provider.model.invoke).not.toHaveBeenCalled()
  })

  it('close-out ToolMessage carries the call info, landing request and stage trace', async () => {
    const provider = createStageProvider()
    // A data URL keeps the run off the network and mirrors the persisted shape
    // (CONTEXT: palace imageUrl is always a data URL).
    const imageUrl = 'data:image/png;base64,iVBORw0KGgo='
    ;(provider as unknown as { generateImage: ReturnType<typeof vi.fn> }).generateImage = vi
      .fn()
      .mockResolvedValue({ urls: [imageUrl] })
    const writeProxy = vi.fn(async () => ({ ok: true, action: 'landPalace', data: {} }))
    const graph = buildPalaceSubgraph({
      provider: provider as unknown as LLMProvider,
      writeProxy,
    }).compile()

    const result = await graph.invoke({
      messages: [],
      artworkStyle: 'raster',
      palaceToolCallId: 'call-palace',
      palaceToolName: GENERATE_PALACE_TOOL,
      context: {
        fileUuid: 'file-a',
        selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
      } satisfies ChatContext,
    })

    // Deterministic landing: the payload is serialized to XML by code and lands
    // through the shared write action; the image data URL rides the request, not
    // the model context.
    expect(writeProxy).toHaveBeenCalledTimes(1)
    const [fileUuid, action, args] = writeProxy.mock.calls[0] as unknown as [
      string,
      string,
      { xml: string },
    ]
    expect(fileUuid).toBe('file-a')
    expect(action).toBe('landPalace')
    expect(args.xml).toContain('<node id=')
    expect(args.xml).toContain('type="palace"')
    expect(args.xml).toContain(`imageUrl="${imageUrl}"`)
    expect(args.xml).toContain('sourceNodeIds="n1"')
    expect(args.xml).toContain('<station order="1" x="0.25" y="0.4" linkedNodeId="n1"')

    expect(result.messages).toHaveLength(1)
    const toolMessage = result.messages[0] as ToolMessage
    expect(toolMessage.tool_call_id).toBe('call-palace')
    expect(toolMessage.name).toBe(GENERATE_PALACE_TOOL)
    expect(JSON.parse(String(toolMessage.content))).toEqual({
      ok: true,
      landed: true,
      label: 'Test Palace',
      stations: [
        {
          order: 1,
          content: 'First station',
          anchorVisual: 'A giant bronze bell',
          association: '',
          x: 0.25,
          y: 0.4,
          linkedNodeId: 'n1',
        },
      ],
      sourceNodeIds: ['n1'],
    })
    expect(toolMessage.additional_kwargs.toolSteps).toEqual([
      { step: 'planning-stations' },
      { step: 'generating-image' },
      { step: 'locating-stations' },
    ])
  })

  it('writes the reason into the ToolMessage and the landing error channel when the landing request fails', async () => {
    const provider = createStageProvider()
    const writeProxy = vi.fn(async () => ({ ok: false, error: 'File is not open, cannot land' }))
    const graph = buildPalaceSubgraph({
      provider: provider as unknown as LLMProvider,
      writeProxy,
    }).compile()

    const result = await graph.invoke({
      messages: [],
      artworkStyle: 'vector',
      palaceToolCallId: 'call-palace',
      palaceToolName: GENERATE_PALACE_TOOL,
      context: {
        fileUuid: 'file-a',
        selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
      } satisfies ChatContext,
    })

    expect(result.palaceLandingError).toBe('File is not open, cannot land')
    const toolMessage = result.messages[0] as ToolMessage
    expect(JSON.parse(String(toolMessage.content))).toEqual({
      ok: false,
      error: 'Memory palace generated, but landing failed: File is not open, cannot land',
    })
  })

  it('close-out ToolMessage writes the error payload on the failure path and falls back to the default tool name', async () => {
    const provider = createMockProvider()

    const result = await buildPalaceSubgraph({ provider })
      .compile()
      .invoke({ messages: [], artworkStyle: 'vector', context: null, palaceToolCallId: 'call-x' })

    expect(result.messages).toHaveLength(1)
    const toolMessage = result.messages[0] as ToolMessage
    expect(toolMessage.tool_call_id).toBe('call-x')
    expect(toolMessage.name).toBe(GENERATE_PALACE_TOOL)
    expect(JSON.parse(String(toolMessage.content))).toEqual({
      ok: false,
      error: 'Provide input content for the memory palace.',
    })
    expect(toolMessage.additional_kwargs.toolSteps).toBeUndefined()
  })

  it('clears the previous run palaceResponse at the start of a new run: a failure never reports the old response', async () => {
    const provider = createMockProvider() as unknown as {
      model: { invoke: ReturnType<typeof vi.fn> }
    }
    provider.model.invoke = vi.fn().mockRejectedValue(new Error('plan failed'))

    const result = await buildPalaceSubgraph({
      provider: provider as unknown as LLMProvider,
    })
      .compile()
      .invoke({
        messages: [],
        artworkStyle: 'vector',
        context: {
          fileUuid: 'file-a',
          selectedNodes: [{ id: 'n1', type: 'text' as const, label: 'First station' }],
        } satisfies ChatContext,
        palaceResponse: 'Summary of the memory palace generated in the previous run',
      })

    expect(result.palaceError).toContain('plan failed')
    expect(result.palaceResponse).toBe('')
  })
})
