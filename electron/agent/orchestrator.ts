import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { type LLMProvider, ProviderCapability } from "./providers/index.js";
import { urlToDataUrl } from "./providers/index.js";
import type { AiService } from "./service.js";
import type {
  SelectedNodeContent,
  MemoryPalaceStation,
  GeneratedNode,
  GeneratedEdge,
  MainGraphStateType,
} from "./state.js";
import { MainGraphState } from "./state.js";

// 导出 MindmapContextData 供其他模块使用
export type { MindmapContextData } from "./tools/mindmapContext.js";
import { MindLaneAgent } from "./agenthub/mindlane/mindlaneAgent.js";
import type {
  MindLaneNode,
  MindLaneEdge,
} from "../../src/shared/lib/fileFormat.js";
import { buildPalaceSubgraph } from "./graphs/palaceGraph.js";
import { buildMindmapSubgraph } from "./graphs/mindmapGraph.js";
import { SessionManager } from "./context/sessionManager.js";
import { MindmapContextData } from "./tools/mindmapContext.js";
import { logger } from "./shared/logger.js";
import { createMindmapActionTools } from "./tools/mindmapActions.js";
import { AGENT_LIMITS } from "./config.js";

/**
 * 聊天请求 - 后端统一管理历史消息
 *
 * 只需要传递：
 * - threadId: 会话 ID，后端据此加载历史
 * - message: 当前用户输入（单条）
 * - context: 可选的上下文数据（工作区、思维导图等）
 */
export interface ChatRequest {
  threadId: string;
  /** 当前用户输入（后端会自动加载历史） */
  message: string;
  context?: MindmapContextData;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  mindmapData?: {
    nodes: MindLaneNode[];
    edges: MindLaneEdge[];
    title: string;
  };
  palaceData?: {
    content: string;
    imageUrls?: string[];
    memoryRoute?: MemoryPalaceStation[];
  };
}

/**
 * 流回调接口
 */
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolStart: (name: string, input: Record<string, unknown>) => void;
  onToolEnd: (name: string, output: string) => void;
  onEnd: (response: ChatResponse) => void;
  onError: (error: string) => void;
}

export interface PalaceFromNodesResult {
  ok: true;
  label: string;
  stations: Array<{
    order: number;
    content: string;
    anchorVisual: string;
    association?: string;
    x: number;
    y: number;
    linkedNodeId: string;
  }>;
  imageUrl: string;
  sourceNodeIds: string[];
}

export interface PalaceFromNodesError {
  ok: false;
  error: string;
}

export type NodesToPalaceResult = PalaceFromNodesResult | PalaceFromNodesError;

export class AgentOrchestrator {
  private sessionManager: SessionManager | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private compiledMainGraph: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private compiledMindmapSubgraph: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private compiledPalaceSubgraph: any = null;

  constructor(
    private provider: LLMProvider,
    private aiService: AiService,
    private userDataPath: string,
  ) {}

  /**
   * 获取或创建 SessionManager 实例
   */
  private getSessionManager(workspacePath: string): SessionManager {
    if (
      !this.sessionManager ||
      this.sessionManager.workspacePath !== workspacePath
    ) {
      this.sessionManager = new SessionManager(
        this.userDataPath,
        workspacePath,
      );
    }
    return this.sessionManager;
  }

  private getCompiledMainGraph() {
    if (!this.compiledMainGraph) {
      const graph = this.buildGraph();
      const checkpointer = this.aiService.checkpointer.getAdapter();
      this.compiledMainGraph = graph.compile(
        checkpointer ? { checkpointer } : undefined,
      );
    }
    return this.compiledMainGraph;
  }

  private getCompiledMindmapSubgraph() {
    if (!this.compiledMindmapSubgraph) {
      this.compiledMindmapSubgraph = buildMindmapSubgraph({
        provider: this.provider,
      }).compile();
    }
    return this.compiledMindmapSubgraph;
  }

  private getCompiledPalaceSubgraph() {
    if (!this.compiledPalaceSubgraph) {
      this.compiledPalaceSubgraph = buildPalaceSubgraph({
        provider: this.provider,
      }).compile();
    }
    return this.compiledPalaceSubgraph;
  }

  async run(request: ChatRequest): Promise<ChatResponse> {
    // 从后端加载历史消息并构建上下文
    const contextMessages = await this.buildContextMessages(request);
    const app = this.getCompiledMainGraph();

    const result = await app.invoke(
      { messages: contextMessages, context: request.context ?? null },
      { recursionLimit: AGENT_LIMITS.recursionLimit, configurable: { thread_id: request.threadId } },
    );

    return this.buildResponse(result as MainGraphStateType);
  }

  async stream(
    request: ChatRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    // 从后端加载历史消息并构建上下文
    const contextMessages = await this.buildContextMessages(request);
    const app = this.getCompiledMainGraph();

    let fullContent = "";

    try {
      const streamConfig = {
        version: "v2" as const,
        signal,
        recursionLimit: AGENT_LIMITS.recursionLimit,
        configurable: { thread_id: request.threadId },
      };

      const stream = app.streamEvents(
        { messages: contextMessages, context: request.context ?? null },
        streamConfig,
      );

      for await (const event of stream) {
        if (signal?.aborted) break;

        if (event.event === "on_chat_model_stream") {
          const chunk = event.data?.chunk;
          if (chunk && typeof chunk.content === "string" && chunk.content) {
            fullContent += chunk.content;
            callbacks.onToken(chunk.content);
          }
        } else if (event.event === "on_tool_start") {
          const toolName = event.name ?? "unknown";
          const input = (event.data?.input ?? {}) as Record<string, unknown>;
          callbacks.onToolStart(toolName, input);
        } else if (event.event === "on_tool_end") {
          const toolName = event.name ?? "unknown";
          const output = event.data?.output;
          const outputStr =
            typeof output === "string" ? output : JSON.stringify(output ?? "");
          callbacks.onToolEnd(toolName, outputStr);
        }
      }
      let result: MainGraphStateType | null = null;
      try {
        const snapshot = await app.getState({
          configurable: { thread_id: request.threadId },
        });
        result = snapshot.values as MainGraphStateType;
      } catch (err) {
        logger.warn('[AgentOrchestrator] getState 失败，回退到流式内容:', err);
      }

      if (result) {
        callbacks.onEnd(this.buildResponse(result, fullContent));
      } else {
        callbacks.onEnd({ content: fullContent || "抱歉，我无法生成回复。" });
      }
    } catch (err) {
      if (signal?.aborted) {
        callbacks.onEnd({ content: fullContent || "（已停止生成）" });
        return;
      }
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async runPalaceFromNodes(
    selectedNodes: SelectedNodeContent[],
  ): Promise<NodesToPalaceResult> {
    if (selectedNodes.length === 0) {
      return { ok: false, error: "未选中任何节点" };
    }

    const caps = this.provider.capabilities;
    if (
      !caps.has(ProviderCapability.ImageGen) ||
      !caps.has(ProviderCapability.Vision)
    ) {
      return {
        ok: false,
        error: "当前 provider 不支持记忆宫殿功能（需要文生图和视觉理解能力）",
      };
    }

    // 使用独立的 Palace Subgraph
    const app = this.getCompiledPalaceSubgraph();

    try {
      const result = await app.invoke(
        {
          messages: [],
          context: null,
          error: "",
          palaceInputText: "",
          palaceInputNodes: selectedNodes,
          memoryItems: [],
          palace: null,
          imagePrompt: "",
          imageUrls: [],
          detectedCoords: [],
          memoryRoute: [],
        },
        { recursionLimit: AGENT_LIMITS.recursionLimit },
      );

      if (result.error) {
        return { ok: false, error: result.error };
      }

      let imageUrl = "";
      if (result.imageUrls.length > 0) {
        const url = result.imageUrls[0]!;
        try {
          imageUrl = url.startsWith("data:") ? url : await urlToDataUrl(url);
        } catch {
          imageUrl = url;
        }
      }

      return {
        ok: true,
        label: result.palace?.theme || `记忆宫殿 (${selectedNodes.length} 站)`,
        stations: result.memoryRoute.map((s: MemoryPalaceStation) => ({
          order: s.order,
          content: s.content,
          anchorVisual: s.anchorVisual ?? "",
          association: s.association,
          x: s.x,
          y: s.y,
          linkedNodeId: s.linkedNodeId ?? "",
        })),
        imageUrl,
        sourceNodeIds: selectedNodes.map((n) => n.id),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private buildGraph(_ctx?: MindmapContextData) {
    const caps = this.provider.capabilities;
    const hasPalace =
      caps.has(ProviderCapability.ImageGen) &&
      caps.has(ProviderCapability.Vision);

    const tools: StructuredToolInterface[] = [];
    const actionTools = createMindmapActionTools(hasPalace);
    tools.push(
      actionTools.addTextNodeTool,
      actionTools.updateNodeTool,
      actionTools.deleteNodeTool,
      actionTools.batchAddNodesTool,
    );
    if (hasPalace && actionTools.addPalaceNodeTool) {
      tools.push(actionTools.addPalaceNodeTool);
    }
    const profileText = this.aiService.userProfile.getText();

    const supervisor = new MindLaneAgent(
      this.provider,
      tools,
      profileText,
      { hasEmbeddings: false, hasPalace },
    );

    // 链式构造：一次性把所有节点加进去，让 TypeScript 累积节点名联合类型 N。
    // 拆开写或在 if 分支里 reassign 会丢失类型，因此根据 hasPalace 走两条完整链。
    if (hasPalace) {
      const graph = new StateGraph(MainGraphState)
        .addNode("supervisor", (state) => supervisor.invoke(state))
        .addNode("tools", (state) => supervisor.invokeTools(state))
        .addNode("mindmapSubgraph", this.getCompiledMindmapSubgraph())
        .addNode("palaceSubgraph", this.getCompiledPalaceSubgraph())
        .addEdge(START, "supervisor")
        .addConditionalEdges(
          "supervisor",
          (state: MainGraphStateType) => {
            const route = supervisor.route(state);
            if (route === "supervisor") return "supervisor";
            return route;
          },
          {
            tools: "tools",
            supervisor: "supervisor",
            mindmapSubgraph: "mindmapSubgraph",
            palaceSubgraph: "palaceSubgraph",
            __end__: END,
          },
        )
        .addEdge("mindmapSubgraph", END)
        .addEdge("palaceSubgraph", END)
        .addEdge("tools", "supervisor");

      return graph;
    }

    const graph = new StateGraph(MainGraphState)
      .addNode("supervisor", (state) => supervisor.invoke(state))
      .addNode("tools", (state) => supervisor.invokeTools(state))
      .addNode("mindmapSubgraph", this.getCompiledMindmapSubgraph())
      .addEdge(START, "supervisor")
      .addConditionalEdges(
        "supervisor",
        (state: MainGraphStateType) => {
          const route = supervisor.route(state);
          if (route === "supervisor") return "supervisor";
          if (route === "palaceSubgraph") return "__end__";
          return route;
        },
        {
          tools: "tools",
          supervisor: "supervisor",
          mindmapSubgraph: "mindmapSubgraph",
          __end__: END,
        },
      )
      .addEdge("mindmapSubgraph", END)
      .addEdge("tools", "supervisor");

    return graph;
  }

  /**
   * 构建响应对象
   */
  private buildResponse(
    result: MainGraphStateType,
    streamingContent?: string,
  ): ChatResponse {
    const rawContent =
      streamingContent || result.response || "抱歉，我无法生成回复。";

    const response: ChatResponse = {
      content: rawContent,
      toolCalls: this.extractToolCalls(result.messages),
    };

    if (result.intent === "mindmap" && result.mindmapNodes.length > 0) {
      response.mindmapData = this.mapMindmapResult(
        result.mindmapNodes,
        result.mindmapEdges,
        result.mindmapTitle,
      );
    }

    if (result.intent === "palace" && result.memoryRoute.length > 0) {
      response.palaceData = {
        content: rawContent,
        imageUrls: result.imageUrls,
        memoryRoute: result.memoryRoute,
      };
    }

    return response;
  }

  /**
   * 构建上下文消息 - 从后端加载历史并压缩
   */
  private async buildContextMessages(
    request: ChatRequest,
  ): Promise<BaseMessage[]> {
    // 从上下文中获取工作区路径
    const workspacePath = request.context?.workspacePath;

    if (!workspacePath) {
      // 没有工作区时，仅使用当前消息
      return [new HumanMessage(request.message)];
    }

    // 从后端加载历史并构建上下文消息
    const sessionManager = this.getSessionManager(workspacePath);
    return sessionManager.buildContextMessages(
      request.threadId,
      this.provider,
      request.message,
    );
  }

  private extractToolCalls(messages: BaseMessage[]): ChatResponse["toolCalls"] {
    const toolCalls: ChatResponse["toolCalls"] = [];
    for (const msg of messages) {
      if (msg.getType() === "tool") {
        const toolMsg = msg as BaseMessage & {
          name?: string;
          content: unknown;
        };
        const name = toolMsg.name ?? "unknown";
        const resultStr =
          typeof toolMsg.content === "string"
            ? toolMsg.content
            : JSON.stringify(toolMsg.content);
        toolCalls.push({ name, args: {}, result: resultStr });
      }
    }
    return toolCalls.length > 0 ? toolCalls : undefined;
  }

  private mapMindmapResult(
    mindmapNodes: GeneratedNode[],
    mindmapEdges: GeneratedEdge[],
    mindmapTitle: string,
  ): ChatResponse["mindmapData"] {
    const mappedNodes = mindmapNodes.map((n) => {
      if (n.type === "document") {
        return {
          id: n.id,
          type: "document" as const,
          position: { x: 0, y: 0 },
          data: {
            filename: (n.data as { filename?: string }).filename ?? "",
            excerpt: (n.data as { excerpt?: string }).excerpt ?? "",
            fullTextPath: (n.data as { fullTextPath?: string }).fullTextPath,
          },
        };
      }
      return {
        id: n.id,
        type: "text" as const,
        position: { x: 0, y: 0 },
        data: { label: (n.data as { label?: string }).label ?? "" },
      };
    }) as MindLaneNode[];

    return {
      nodes: mappedNodes,
      edges: mindmapEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
      })),
      title: mindmapTitle || "生成的思维导图",
    };
  }
}
