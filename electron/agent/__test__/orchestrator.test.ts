import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentOrchestrator } from "../orchestrator.js";
import { AiService } from "../service.js";
import { ProviderCapability, type LLMProvider } from "../providers/index.js";

// ─── Mock 工厂 ───────────────────────────────────────────────

function createMockProvider(
  capabilities: Set<ProviderCapability> = new Set([ProviderCapability.Chat]),
): LLMProvider {
  const mockModel = {
    invoke: vi.fn(),
    bindTools: vi.fn().mockReturnValue({ invoke: vi.fn() }),
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: vi.fn() }),
  };

  return {
    reasoningModel: mockModel,
    visionModel: undefined,
    capabilities,
    chatModels: [],
  } as unknown as LLMProvider;
}

function createMockAiService(checkpointer?: unknown): AiService {
  return {
    checkpointer: {
      getAdapter: vi.fn().mockReturnValue(checkpointer),
      get: vi.fn().mockReturnValue(null),
    },
    userProfile: {
      getText: vi.fn().mockReturnValue(""),
    },
  } as unknown as AiService;
}

// ─── 测试 ────────────────────────────────────────────────────

describe("AgentOrchestrator 编译缓存", () => {
  let provider: LLMProvider;
  let aiService: AiService;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    provider = createMockProvider();
    aiService = createMockAiService();
    orchestrator = new AgentOrchestrator(provider, aiService, "/tmp");
  });

  it("getCompiledMainGraph() 多次调用返回同一实例", () => {
    const getCompiledMainGraph = (orchestrator as unknown as Record<string, () => unknown>)["getCompiledMainGraph"].bind(orchestrator);
    expect(getCompiledMainGraph()).toBe(getCompiledMainGraph());
  });

  it("getCompiledMindmapSubgraph() 多次调用返回同一实例", () => {
    const getCompiledMindmapSubgraph = (orchestrator as unknown as Record<string, () => unknown>)["getCompiledMindmapSubgraph"].bind(orchestrator);
    expect(getCompiledMindmapSubgraph()).toBe(getCompiledMindmapSubgraph());
  });

  it("getCompiledPalaceSubgraph() 多次调用返回同一实例", () => {
    provider = createMockProvider(
      new Set([ProviderCapability.Chat, ProviderCapability.ImageGen, ProviderCapability.Vision]),
    );
    orchestrator = new AgentOrchestrator(provider, aiService, "/tmp");
    const getCompiledPalaceSubgraph = (orchestrator as unknown as Record<string, () => unknown>)["getCompiledPalaceSubgraph"].bind(orchestrator);
    expect(getCompiledPalaceSubgraph()).toBe(getCompiledPalaceSubgraph());
  });
});

describe("AgentOrchestrator checkpointer 注入", () => {
  it("getCompiledMainGraph() 优先使用 aiService.checkpointer.getAdapter() 返回的 checkpointer", () => {
    const mockCheckpointer = { put: vi.fn(), get: vi.fn() };
    const provider = createMockProvider();
    const aiService = createMockAiService(mockCheckpointer);
    const orchestrator = new AgentOrchestrator(provider, aiService, "/tmp");

    const getCompiledMainGraph = (orchestrator as unknown as Record<string, () => unknown>)["getCompiledMainGraph"].bind(orchestrator);

    getCompiledMainGraph();

    expect(aiService.checkpointer.getAdapter).toHaveBeenCalled();
  });

  it("getCompiledMainGraph() 在 checkpointer 为 undefined 时不报错", () => {
    const provider = createMockProvider();
    const aiService = createMockAiService(undefined);
    const orchestrator = new AgentOrchestrator(provider, aiService, "/tmp");

    const getCompiledMainGraph = (orchestrator as unknown as Record<string, () => unknown>)["getCompiledMainGraph"].bind(orchestrator);

    expect(() => getCompiledMainGraph()).not.toThrow();

    const instance = getCompiledMainGraph();
    expect(instance).toBeDefined();
  });
});
