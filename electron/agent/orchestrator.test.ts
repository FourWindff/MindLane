import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentServices } from './service.js'
import { ProviderCapability, type LLMProvider } from './providers/index.js'
import { AgentOrchestrator } from './orchestrator.js'

// ─── Mock factory ────────────────────────────────────────────

function createMockProvider(
  capabilities: Set<ProviderCapability> = new Set([ProviderCapability.Chat]),
): LLMProvider {
  const mockModel = {
    invoke: vi.fn(),
    bindTools: vi.fn().mockReturnValue({ invoke: vi.fn() }),
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: vi.fn() }),
  }

  return {
    model: mockModel,
    visionModel: undefined,
    capabilities,
    models: [],
  } as unknown as LLMProvider
}

// Boundary cast (the only lie): graph-structure tests never run real service paths such as the extraction callback.
function createMockServices(checkpointer?: unknown): AgentServices {
  return {
    checkpointer: {
      getAdapter: vi.fn().mockReturnValue(checkpointer),
    },
  } as unknown as AgentServices
}

// ─── Tests ───────────────────────────────────────────────────

describe('AgentOrchestrator compiled cache', () => {
  let provider: LLMProvider
  let services: AgentServices
  let orchestrator: AgentOrchestrator

  beforeEach(() => {
    provider = createMockProvider()
    services = createMockServices()
    orchestrator = new AgentOrchestrator(provider, services)
  })

  it('getCompiledMindmapSubgraph() returns the same instance across calls', () => {
    const getCompiledMindmapSubgraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'getCompiledMindmapSubgraph'
    ].bind(orchestrator)
    expect(getCompiledMindmapSubgraph()).toBe(getCompiledMindmapSubgraph())
  })

  it('getCompiledPalaceSubgraph() returns the same instance across calls', () => {
    provider = createMockProvider(
      new Set([ProviderCapability.Chat, ProviderCapability.ImageGen, ProviderCapability.Vision]),
    )
    orchestrator = new AgentOrchestrator(provider, services)
    const getCompiledPalaceSubgraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'getCompiledPalaceSubgraph'
    ].bind(orchestrator)
    expect(getCompiledPalaceSubgraph()).toBe(getCompiledPalaceSubgraph())
  })
})

describe('AgentOrchestrator buildGraph structure', () => {
  /** Conditional-edge targets of a node, read straight off the un-compiled graph. */
  function branchEnds(graph: unknown, node: string): Record<string, string> {
    const branches = (
      graph as { branches: Record<string, { condition: { ends: Record<string, string> } }> }
    ).branches
    return branches[node]?.condition.ends ?? {}
  }

  it('the graph node structure is identical regardless of provider capabilities', () => {
    const providerWithPalace = createMockProvider(
      new Set([ProviderCapability.Chat, ProviderCapability.ImageGen, ProviderCapability.Vision]),
    )
    const providerWithoutPalace = createMockProvider(new Set([ProviderCapability.Chat]))

    const orchestratorWith = new AgentOrchestrator(providerWithPalace, createMockServices())
    const orchestratorWithout = new AgentOrchestrator(providerWithoutPalace, createMockServices())

    const buildGraphWith = (
      orchestratorWith as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestratorWith)
    const buildGraphWithout = (
      orchestratorWithout as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestratorWithout)

    const graphWith = buildGraphWith()
    const graphWithout = buildGraphWithout()

    expect(Object.keys(graphWith.nodes)).toContain('palaceSubgraph')
    expect(Object.keys(graphWith.nodes)).toContain('mindmapSubgraph')
    expect(Object.keys(graphWith.nodes)).not.toContain('subgraphResult')
    expect(Object.keys(graphWithout.nodes)).toContain('palaceSubgraph')
    expect(Object.keys(graphWith.nodes)).toEqual(Object.keys(graphWithout.nodes))
  })

  it('mounts both subgraphs as compiled graphs (not nested invoke inside a node function)', () => {
    const orchestrator = new AgentOrchestrator(createMockProvider(), createMockServices())

    const graph = (
      orchestrator as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestrator)()

    for (const name of ['mindmapSubgraph', 'palaceSubgraph']) {
      const node = graph.nodes[name] as { runnable?: { constructor?: { name?: string } } }
      expect(node.runnable?.constructor?.name).toBe('CompiledStateGraph')
    }
  })

  it('START dispatches on the entry marker: chat goes through compaction, a manual palace run goes straight to the palace subgraph', () => {
    const orchestrator = new AgentOrchestrator(createMockProvider(), createMockServices())

    const graph = (orchestrator as unknown as Record<string, () => unknown>)['buildGraph'].bind(
      orchestrator,
    )()

    expect(branchEnds(graph, '__start__')).toEqual({
      contextCompact: 'contextCompact',
      palaceSubgraph: 'palaceSubgraph',
    })
  })

  it('every subgraph node goes straight back to the supervisor: there is no collector node', () => {
    const orchestrator = new AgentOrchestrator(createMockProvider(), createMockServices())

    const graph = (
      orchestrator as unknown as {
        buildGraph: () => unknown
      }
    )['buildGraph'].bind(orchestrator)()
    const edges = Array.from((graph as { edges: Iterable<[string, string]> }).edges).map((edge) =>
      edge.join('->'),
    )

    expect(edges).toContain('mindmapSubgraph->supervisor')
    // The palace node goes back to the supervisor on a chat run, and ends the
    // run on the manual entry (which never reaches the supervisor).
    expect(branchEnds(graph, 'palaceSubgraph')).toEqual({
      supervisor: 'supervisor',
      __end__: '__end__',
    })
  })
})

describe('AgentOrchestrator contextCompact node', () => {
  it('graph includes contextCompact node', () => {
    const provider = createMockProvider()
    const orchestrator = new AgentOrchestrator(provider, createMockServices())

    const buildGraph = (
      orchestrator as unknown as Record<string, () => { nodes: Record<string, unknown> }>
    )['buildGraph'].bind(orchestrator)
    const graph = buildGraph()

    expect(Object.keys(graph.nodes)).toContain('contextCompact')
  })

  it('START entry is conditional: compaction for chat, palace subgraph for the manual run', () => {
    const provider = createMockProvider()
    const orchestrator = new AgentOrchestrator(provider, createMockServices())

    const buildGraph = (orchestrator as unknown as Record<string, () => unknown>)[
      'buildGraph'
    ].bind(orchestrator)
    const graph = buildGraph()

    const ends =
      (graph as { branches: Record<string, { condition: { ends: Record<string, string> } }> })
        .branches['__start__']?.condition.ends ?? {}
    expect(ends.contextCompact).toBe('contextCompact')
    expect(ends.palaceSubgraph).toBe('palaceSubgraph')
  })
})
