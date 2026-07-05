import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnchorAgent } from '../anchorAgent.js'
import type { LLMProvider } from '../../providers/index.js'
import type { PalaceSubgraphStateType } from '../../state.js'

describe('AnchorAgent error logging', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs warning when locateAnchors fails and falls back to canonical layout', async () => {
    const mockProvider = {
      visionModel: {
        invoke: vi.fn().mockRejectedValue(new Error('vision model unavailable')),
      },
      reasoningModel: {
        invoke: vi.fn().mockResolvedValue({ content: 'summary text' }),
      },
    } as unknown as LLMProvider

    const agent = new AnchorAgent(mockProvider)
    const state = {
      palace: {
        theme: 'test',
        stations: [
          { order: 1, content: 'A', anchorVisual: 'apple', mnemonicMethod: 'x', association: 'y' },
        ],
      },
      imageUrls: ['https://example.com/img.png'],
    } as unknown as PalaceSubgraphStateType

    const result = await agent.invoke(state)

    expect(consoleLogSpy).toHaveBeenCalled()
    const warnCall = consoleLogSpy.mock.calls.find((call: unknown[]) =>
      call.some(
        (arg: unknown) => String(arg).includes('locateAnchors') || String(arg).includes('降级'),
      ),
    )
    expect(warnCall).toBeDefined()
    expect(result.memoryRoute).toBeDefined()
    expect(result.memoryRoute!.length).toBeGreaterThan(0)
  })

  it('logs warning when summary generation fails and falls back to default', async () => {
    const mockProvider = {
      visionModel: {
        invoke: vi.fn().mockResolvedValue({ content: '[{"order":1,"x":0.5,"y":0.5}]' }),
      },
      reasoningModel: {
        invoke: vi.fn().mockRejectedValue(new Error('summary generation failed')),
      },
    } as unknown as LLMProvider

    const agent = new AnchorAgent(mockProvider)
    const state = {
      palace: {
        theme: 'test',
        stations: [
          { order: 1, content: 'A', anchorVisual: 'apple', mnemonicMethod: 'x', association: 'y' },
        ],
      },
      imageUrls: ['https://example.com/img.png'],
    } as unknown as PalaceSubgraphStateType

    const result = await agent.invoke(state)

    expect(consoleLogSpy).toHaveBeenCalled()
    expect(result.response).toBeDefined()
    expect(result.response!.length).toBeGreaterThan(0)
  })
})
