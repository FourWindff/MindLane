import type { LLMProvider } from '../providers/index.js'
import type { MainGraphStateType, PalaceSubgraphStateType } from '../state.js'

/**
 * Agent base class - the abstract base for every agent.
 *
 * Architectural principles:
 * - Only MindLaneAgent owns memory, context management, and tool binding.
 * - Other agents (Analyze, ImageGen, Vision) do not touch persistent memory.
 * - Every agent performs its task through the unified invoke(state) interface.
 * - MindLaneAgent declares its own route(state) method (the base declares and calls nothing).
 *
 * State types:
 * - MindLaneAgent: MainGraphStateType
 * - Analyze/ImageGen/Vision: PalaceSubgraphStateType
 */
export abstract class BaseAgent {
  constructor(protected provider: LLMProvider) {}

  /**
   * Run the agent's main logic.
   * @param state - Current agent state
   * @returns Partial state update
   */
  abstract invoke(state: MainGraphStateType): Promise<Partial<MainGraphStateType>>
}

/**
 * Base class for palace-subgraph agents.
 * Used by agents in the palace subgraph such as Analyze, ImageGen, and Vision.
 */
export abstract class PalaceAgent {
  constructor(protected provider: LLMProvider) {}

  abstract invoke(state: PalaceSubgraphStateType): Promise<Partial<PalaceSubgraphStateType>>
}
