import { describe, it, expect, vi } from 'vitest'
import { buildPalaceSubgraph } from '../palaceGraph.js'
import { ProviderCapability, type LLMProvider } from '../../providers/index.js'

function createMockProvider(): LLMProvider {
  return {
    reasoningModel: {
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
    chatModels: [],
    generateImage: vi.fn().mockResolvedValue({ urls: ['https://example.com/image.png'] }),
  } as unknown as LLMProvider
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
})
