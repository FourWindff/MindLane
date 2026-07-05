import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MiniMaxProvider,
  ProviderCapability,
  createProvider,
  getRegisteredProviders,
} from '../index.js'

describe('MiniMaxProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('declares chat and image generation capabilities only', () => {
    const provider = new MiniMaxProvider({
      apiKey: 'test-key',
      chatModel: 'MiniMax-M2.7',
    })

    expect(provider.capabilities.has(ProviderCapability.Chat)).toBe(true)
    expect(provider.capabilities.has(ProviderCapability.ImageGen)).toBe(true)
    expect(provider.capabilities.has(ProviderCapability.Vision)).toBe(false)
    expect(provider.capabilities.has(ProviderCapability.Embeddings)).toBe(false)
    expect(provider.visionModel).toBeUndefined()
  })

  it('registers MiniMax in the provider registry', () => {
    const providers = getRegisteredProviders()
    const minimax = providers.find((provider) => provider.id === 'minimax')

    expect(minimax).toBeDefined()
    expect(minimax?.capabilities).toEqual([ProviderCapability.Chat, ProviderCapability.ImageGen])

    const provider = createProvider('minimax', {
      apiKey: 'test-key',
      chatModel: 'MiniMax-M2.7',
    })

    expect(provider).toBeInstanceOf(MiniMaxProvider)
  })

  it('normalizes image urls from the MiniMax image API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        base_resp: { status_code: 0, status_msg: 'success' },
        data: {
          image_urls: ['https://img.example/1.png', { url: 'https://img.example/2.png' }],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new MiniMaxProvider({
      apiKey: 'test-key',
      chatModel: 'MiniMax-M2.7',
    })

    const result = await provider.generateImage({
      prompt: 'draw a bright memory palace',
      size: '1024*1024',
      n: 2,
    })

    expect(result.urls).toEqual(['https://img.example/1.png', 'https://img.example/2.png'])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(requestInit.body))
    expect(body.aspect_ratio).toBe('1:1')
    expect(body.response_format).toBe('url')
    expect(body.n).toBe(2)
  })

  it('maps image sizes to supported MiniMax aspect ratios in requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        base_resp: { status_code: 0, status_msg: 'success' },
        data: { image_urls: ['https://img.example/1.png'] },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new MiniMaxProvider({
      apiKey: 'test-key',
      chatModel: 'MiniMax-M2.7',
    })

    await provider.generateImage({ prompt: 'wide', size: '1024*768' })
    await provider.generateImage({ prompt: 'tall', size: '768*1024' })
    await provider.generateImage({ prompt: 'invalid', size: 'not-a-size' })

    const bodies = fetchMock.mock.calls.map(([, requestInit]) =>
      JSON.parse(String((requestInit as RequestInit).body)),
    )
    expect(bodies.map((body) => body.aspect_ratio)).toEqual(['4:3', '3:4', '1:1'])
  })

  it('surfaces upstream image errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        base_resp: { status_code: 1004, status_msg: 'invalid prompt' },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new MiniMaxProvider({
      apiKey: 'test-key',
      chatModel: 'MiniMax-M2.7',
    })

    await expect(
      provider.generateImage({
        prompt: 'bad',
      }),
    ).rejects.toThrow('invalid prompt')
  })
})
