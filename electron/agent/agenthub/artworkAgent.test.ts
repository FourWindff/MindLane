import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtworkAgent, extractSvgArtwork, svgToDataUrl } from './artworkAgent.js'
import { ProviderCapability, type LLMProvider } from '../providers/index.js'
import type { PalaceSubgraphStateType } from '../state.js'

const SVG = '<svg viewBox="0 0 1000 1000"><circle cx="250" cy="400" r="20"/></svg>'

const PALACE = {
  theme: 'Test palace',
  sceneBrief: 'A hall with three landmarks',
  routeStyle: 'arc',
  stations: [
    {
      order: 1,
      content: 'First station',
      anchorVisual: 'A giant bronze bell',
      mnemonicMethod: 'Visual association',
      association: '',
      linkedNodeId: 'n1',
    },
  ],
}

function createProvider(
  options: {
    modelInvoke?: (messages: unknown[]) => Promise<{ content: string }>
    generateImage?: () => Promise<{ urls: string[] }>
    capabilities?: ReadonlySet<ProviderCapability>
  } = {},
): LLMProvider {
  return {
    model: {
      invoke: vi.fn(options.modelInvoke ?? (async () => ({ content: SVG }))),
    },
    capabilities: options.capabilities ?? new Set([ProviderCapability.Chat]),
    generateImage: vi.fn(options.generateImage ?? (async () => ({ urls: [] }))),
  } as unknown as LLMProvider
}

function createState(partial: Partial<PalaceSubgraphStateType> = {}): PalaceSubgraphStateType {
  return {
    palace: PALACE,
    palaceError: '',
    artworkStyle: 'vector',
    imageUrl: undefined,
    ...partial,
  } as unknown as PalaceSubgraphStateType
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('extractSvgArtwork', () => {
  it('pulls the SVG block out of a reply that also carries other text', () => {
    expect(extractSvgArtwork(`Here is the scene:\n${SVG}\nEnjoy.`)).toBe(SVG)
  })

  it('returns null when the reply carries no SVG block', () => {
    expect(extractSvgArtwork('I cannot draw that.')).toBeNull()
    expect(extractSvgArtwork('')).toBeNull()
  })

  it('encodes the SVG as a base64 data URL', () => {
    expect(svgToDataUrl(SVG)).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})

describe('ArtworkAgent', () => {
  it('keeps a drawn SVG as the single artwork, with no coordinate protocol', async () => {
    const provider = createProvider()

    const result = await new ArtworkAgent(provider).invoke(createState())

    expect(result.imageUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    // The drawing prompt asks for a scene, not for station markers or coordinates.
    const prompt = (provider.model.invoke as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Array<{ content: string }>
    const system = prompt[0]!.content
    expect(system).not.toContain('data-station')
    expect(system).not.toContain('"stations"')
    expect(system).toContain('decorative')
  })

  it('keeps an SVG without viewBox or station markers: there is no artwork gate', async () => {
    const bare = '<svg><circle cx="10" cy="10" r="4" /></svg>'
    const provider = createProvider({ modelInvoke: async () => ({ content: bare }) })

    const result = await new ArtworkAgent(provider).invoke(createState())

    expect(result.imageUrl).toBe(svgToDataUrl(bare))
  })

  it('treats a reply without a usable SVG as "no artwork" instead of failing', async () => {
    const provider = createProvider({ modelInvoke: async () => ({ content: 'no drawing' }) })

    const result = await new ArtworkAgent(provider).invoke(createState())

    expect(result.imageUrl).toBeUndefined()
  })

  it('treats an unparseable SVG block as "no artwork" instead of failing', async () => {
    const provider = createProvider({
      modelInvoke: async () => ({ content: '<svg><circle></svg>' }),
    })

    const result = await new ArtworkAgent(provider).invoke(createState())

    expect(result.imageUrl).toBeUndefined()
  })

  it('swallows drawing failures: the palace simply has no artwork', async () => {
    const provider = createProvider({
      modelInvoke: async () => {
        throw new Error('model call failed')
      },
    })

    await expect(new ArtworkAgent(provider).invoke(createState())).resolves.toEqual({
      imageUrl: undefined,
    })
  })

  it('falls back to drawing when the raster preference meets a provider without image generation', async () => {
    const provider = createProvider()
    const state = createState({ artworkStyle: 'raster' })

    const result = await new ArtworkAgent(provider).invoke(state)

    expect(result.imageUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(provider.generateImage).not.toHaveBeenCalled()
  })

  it('generates one bitmap background when the provider supports image generation', async () => {
    const provider = createProvider({
      capabilities: new Set([ProviderCapability.Chat, ProviderCapability.ImageGen]),
      generateImage: async () => ({ urls: ['data:image/png;base64,iVBORw0KGgo='] }),
    })

    const result = await new ArtworkAgent(provider).invoke(createState({ artworkStyle: 'raster' }))

    expect(result.imageUrl).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(provider.model.invoke).not.toHaveBeenCalled()
    const call = (provider.generateImage as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { prompt: string }
    expect(call.prompt).toContain('A giant bronze bell')
  })

  it('converts a remote bitmap URL into a data URL so landing can materialize it', async () => {
    const provider = createProvider({
      capabilities: new Set([ProviderCapability.Chat, ProviderCapability.ImageGen]),
      generateImage: async () => ({ urls: ['https://example.com/palace.png'] }),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => Buffer.from('fake-image-bytes').buffer,
      }),
    )

    const result = await new ArtworkAgent(provider).invoke(createState({ artworkStyle: 'raster' }))

    expect(result.imageUrl).toMatch(/^data:image\/png;base64,/)
    vi.unstubAllGlobals()
  })

  it('treats an unreadable remote bitmap as "no artwork" instead of failing', async () => {
    const provider = createProvider({
      capabilities: new Set([ProviderCapability.Chat, ProviderCapability.ImageGen]),
      generateImage: async () => ({ urls: ['https://example.com/missing.png'] }),
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const result = await new ArtworkAgent(provider).invoke(createState({ artworkStyle: 'raster' }))

    expect(result.imageUrl).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('swallows image-generation failures: stations and the tour never depend on the artwork', async () => {
    const provider = createProvider({
      capabilities: new Set([ProviderCapability.Chat, ProviderCapability.ImageGen]),
      generateImage: async () => {
        throw new Error('image model unavailable')
      },
    })

    await expect(
      new ArtworkAgent(provider).invoke(createState({ artworkStyle: 'raster' })),
    ).resolves.toEqual({ imageUrl: undefined })
  })

  it('does nothing when planning already failed', async () => {
    const provider = createProvider()
    const result = await new ArtworkAgent(provider).invoke(
      createState({ palace: null, palaceError: 'plan failed' }),
    )

    expect(result).toEqual({})
    expect(provider.model.invoke).not.toHaveBeenCalled()
  })
})
