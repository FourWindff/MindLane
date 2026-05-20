import { describe, it, expect, vi } from 'vitest'
import { buildMindmapSubgraph } from '../mindmapGraph.js'
import type { LLMProvider } from '../../providers/index.js'

describe('MindmapGraph error with stack', () => {
  it('includes stack trace in state.error when generation fails', async () => {
    const mockProvider = {
      reasoningModel: {
        invoke: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      },
    } as unknown as LLMProvider

    const graph = buildMindmapSubgraph({ provider: mockProvider })
    const app = graph.compile()

    const result = await app.invoke({
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputText: 'some document text',
      mindmapInputTitle: '',
      mindmapNodes: [],
      mindmapEdges: [],
      mindmapTitle: '',
    })

    expect(result.error).toContain('LLM timeout')
    expect(result.error).toContain('at') // stack trace
  })
})
