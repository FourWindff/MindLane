import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnalyzeAgent } from '../analyzeAgent.js'
import type { LLMProvider } from '../../providers/index.js'
import type { PalaceSubgraphStateType } from '../../state.js'

describe('AnalyzeAgent error logging', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs error with stack when analyzeFromText fails', async () => {
    const mockProvider = {
      reasoningModel: {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: vi.fn().mockRejectedValue(new Error('structured output failed')),
        }),
      },
    } as unknown as LLMProvider

    const agent = new AnalyzeAgent(mockProvider)
    const state = {
      palaceInputText: 'some text to analyze',
      palaceInputNodes: [],
      messages: [],
    } as unknown as PalaceSubgraphStateType

    const result = await agent.invoke(state)

    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.error).toContain('structured output failed')
  })

  it('logs error with stack when analyzeFromNodes fails', async () => {
    const mockProvider = {
      reasoningModel: {
        withStructuredOutput: vi.fn(),
        invoke: vi.fn().mockRejectedValue(new Error('model invocation failed')),
      },
    } as unknown as LLMProvider

    const agent = new AnalyzeAgent(mockProvider)
    const state = {
      palaceInputText: '',
      palaceInputNodes: [{ id: 'n1', label: 'Node 1' }],
      messages: [],
    } as unknown as PalaceSubgraphStateType

    const result = await agent.invoke(state)

    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.error).toContain('model invocation failed')
  })
})
