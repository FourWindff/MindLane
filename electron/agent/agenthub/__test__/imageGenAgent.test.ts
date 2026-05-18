import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ImageGenAgent } from '../imageGenAgent.js'
import type { LLMProvider } from '../../providers/index.js'
import type { PalaceSubgraphStateType } from '../../state.js'

describe('ImageGenAgent error logging', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs error when image generation fails', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockResolvedValue({ content: 'a prompt' }),
      },
      generateImage: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
    } as unknown as LLMProvider

    const agent = new ImageGenAgent(mockProvider)
    const state = {
      palace: {
        theme: 'test',
        sceneBrief: 'a scene',
        routeStyle: 'arc',
        stations: [{ order: 1, content: 'x', anchorVisual: 'y', mnemonicMethod: 'z', association: 'a' }],
      },
    } as unknown as PalaceSubgraphStateType

    const result = await agent.invoke(state)

    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.imageError).toBe('API rate limit exceeded')
    expect(result.imageUrls).toEqual([])
  })
})
