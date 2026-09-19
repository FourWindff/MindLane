import { describe, it, expect, vi } from 'vitest'
import { buildPalaceSubgraph } from '../palaceGraph.js'
import { ProviderCapability, type LLMProvider } from '../../providers/index.js'
import type { ChatContext } from '../../../ipc.js'
import { resolveArtworkStyle } from '../../../../src/shared/lib/palaceArtworkStyle.js'

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
      theme: '测试宫殿',
      scene_brief: '一间测试大厅',
      route_style: 'arc',
      stations: [
        { order: 1, content: '第一站', anchor_visual: '巨大的铜钟', linked_node_id: 'n1' },
      ],
    }),
  }))
  provider.visionModel.invoke = vi.fn(async () => ({
    content: JSON.stringify([{ order: 1, x: 0.25, y: 0.4 }]),
  }))
  return provider as unknown as LLMProvider
}

describe('buildPalaceSubgraph', () => {
  it('包含 normalizeImages 节点', () => {
    const graph = buildPalaceSubgraph({ provider: createMockProvider() })

    expect(Object.keys(graph.nodes)).toContain('normalizeImages')
  })

  it('imageGen 之后是 normalizeImages，再之后是 vision', () => {
    const graph = buildPalaceSubgraph({ provider: createMockProvider() })

    const edges = Array.from(graph.edges as unknown as Array<[string, string]>)
    expect(edges).toContainEqual(['imageGen', 'normalizeImages'])
    expect(edges).toContainEqual(['normalizeImages', 'vision'])
  })

  it('streams the palace stages in order and collects them into toolSteps', async () => {
    const graph = buildPalaceSubgraph({ provider: createStageProvider() }).compile()

    const steps: string[] = []
    let result!: { toolSteps: Array<{ step: string }> }
    const stream = await graph.stream(
      {
        messages: [],
        artworkStyle: 'raster',
        // Selected nodes take the analyze path that returns one JSON plan.
        context: {
          fileUuid: 'file-a',
          selectedNodes: [{ id: 'n1', type: 'text' as const, label: '第一站' }],
        } satisfies ChatContext,
        // A previous subgraph run's trace must be reset, not appended to.
        toolSteps: [{ step: 'extracting' }],
      },
      { streamMode: ['custom', 'values'] },
    )

    for await (const [mode, event] of stream) {
      if (mode === 'custom') steps.push((event as { step: string }).step)
      if (mode === 'values') result = event as typeof result
    }

    expect(steps).toEqual(['planning-stations', 'generating-image', 'locating-stations'])
    // The persisted trace is the same source as the emitted events.
    expect(result.toolSteps).toEqual([
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
          theme: '测试宫殿',
          scene_brief: '一间测试大厅',
          route_style: 'arc',
          stations: [
            { order: 1, content: '第一站', anchor_visual: '巨大的铜钟', linked_node_id: 'n1' },
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
          selectedNodes: [{ id: 'n1', type: 'text' as const, label: '第一站' }],
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
          theme: '测试宫殿',
          stations: [
            { order: 1, content: '第一站', anchor_visual: '巨大的铜钟', linked_node_id: 'n1' },
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
        selectedNodes: [{ id: 'n1', type: 'text' as const, label: '第一站' }],
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
          theme: '测试宫殿',
          stations: [
            { order: 1, content: '第一站', anchor_visual: '巨大的铜钟', linked_node_id: 'n1' },
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
          selectedNodes: [{ id: 'n1', type: 'text' as const, label: '第一站' }],
        } satisfies ChatContext,
      })

    expect(result.error).toBe('')
    expect(result.imageUrls).toEqual([])
    expect(result.memoryRoute[0]).toMatchObject({ x: 0.25, y: 0.4 })
  })

  it('resolves raster preference only when image generation is available', () => {
    expect(resolveArtworkStyle('raster', new Set([ProviderCapability.ImageGen]))).toBe('raster')
    expect(resolveArtworkStyle('raster', new Set())).toBe('vector')
    expect(resolveArtworkStyle('vector', new Set([ProviderCapability.ImageGen]))).toBe('vector')
    expect(resolveArtworkStyle('vector', new Set())).toBe('vector')
  })
})
