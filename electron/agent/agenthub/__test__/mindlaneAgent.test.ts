import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MindLaneAgent } from '../mindlane/mindlaneAgent.js'
import type { LLMProvider } from '../../providers/index.js'
import type { MainGraphStateType } from '../../state.js'

describe('MindLaneAgent error handling', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs error and writes to state.error when model invocation fails', async () => {
    const mockModelWithTools = {
      invoke: vi.fn().mockRejectedValue(new Error('model connection refused')),
    }
    const mockProvider = {
      reasoningModel: {
        bindTools: vi.fn().mockReturnValue(mockModelWithTools),
      },
    } as unknown as LLMProvider

    const agent = new MindLaneAgent(mockProvider, [], {
      hasEmbeddings: true,
      hasPalace: true,
    })

    const state = {
      messages: [],
      context: null,
      intent: 'qa',
      response: '',
      error: '',
    } as unknown as MainGraphStateType

    const result = await agent.invoke(state)

    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.error).toContain('model connection refused')
    expect(result.error).toContain('at') // stack
  })
})
