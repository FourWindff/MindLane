import { HumanMessage, AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { END, START, StateGraph } from "@langchain/langgraph";
import type { CompiledStateGraph } from "@langchain/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { type LLMProvider, ProviderCapability } from "./providers/index.js";
import { urlToDataUrl } from "./providers/index.js";
import type { AiService } from "./service.js";
import type {
  SelectedNodeContent,
  MemoryPalaceStation,
  MainGraphStateType,
  PalaceSubgraphStateType,
  MindmapSubgraphStateType,
  DocumentRef,
} from "./state.js";
import { MainGraphState } from "./state.js";

// 导出 MindmapContextData 供其他模块使用
export type { MindmapContextData } from "./tools/mindmapContext.js";
import { MindLaneAgent } from "./agenthub/mindlane/mindlaneAgent.js";
import type {
  MindLaneNode,
  MindLaneEdge,
  ChatToolCall,
} from "../../src/shared/lib/fileFormat.js";
import { buildPalaceSubgraph } from "./graphs/palaceGraph.js";
import { buildMindmapSubgraph } from './graphs/mindmapGraph/index.js'
import { MindmapContextData } from "./tools/mindmapContext.js";
import { logger } from "../shared/logger.js";
import { createMindmapActionTools } from "./tools/mindmapActions.js";
import { createSearchLinkedDocumentTool } from "./tools/linkedDocumentSearch.js";
import {
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
  isVirtualSubgraphTool,
} from "./tools/subgraphRoutingTools.js";
import { AGENT_LIMITS } from "./config.js";
import { extractTextContent } from "./utils.js";
import { checkpointMessagesToSessionMessages } from "./memory/checkpointer.js";
import type { CacheManager } from "../fs/cacheManager.js";

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
  /** Optional document reference for mindmap generation from file */
  documentRef?: DocumentRef;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatResponse {
  content: string;
  messages?: AssistantMessage[];
  toolCalls?: ChatToolCall[];
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
  onMessageStart?: () => void;
  onToken: (token: string) => void;
  onToolStart: (name: string, input: Record<string, unknown>) => void;
  onToolEnd: (name: string, output: string) => void;
  onEnd: (response: ChatResponse) => void;
  onError: (error: string) => void;
}

export interface AgentOrchestratorOptions {
  cacheManager?: CacheManager;
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
  private compiledMainGraph: CompiledStateGraph<MainGraphStateType, unknown, string> | null = null;
  private compiledMindmapSubgraph: CompiledStateGraph<MindmapSubgraphStateType, unknown, string> | null = null;
  private compiledPalaceSubgraph: CompiledStateGraph<PalaceSubgraphStateType, unknown, string> | null = null;
  private activeContext: MindmapContextData | null = null;

  constructor(
    private provider: LLMProvider,
    private aiService: AiService,
    private options: AgentOrchestratorOptions = {},
  ) {}

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
        cacheDocumentText: this.options.cacheManager
          ? async (docRef, text) => {
              const metadataTextCacheKey = docRef.metadata?.textCacheKey;
              const textCacheKey = typeof metadataTextCacheKey === 'string' && /^[A-Za-z0-9_-]+$/.test(metadataTextCacheKey)
                ? metadataTextCacheKey
                : docRef.id;
              await this.options.cacheManager!.cacheDocumentText(textCacheKey, text);
              return {
                ...docRef,
                metadata: {
                  ...docRef.metadata,
                  originalPath: docRef.metadata?.originalPath || docRef.source,
                  textCacheKey,
                  textCachedAt: new Date().toISOString(),
                },
              };
            }
          : undefined,
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

  async stream(
    request: ChatRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const app = this.getCompiledMainGraph();
    this.activeContext = request.context ?? null;

    let fullContent = "";
    let currentSegmentContent = "";
    let hasStartedSegment = false;

    try {
      const streamConfig = {
        version: "v2" as const,
        signal,
        recursionLimit: AGENT_LIMITS.recursionLimit,
        configurable: { thread_id: request.threadId },
      };

      // Build initial state from request
      const initialState: Partial<MainGraphStateType> = {
        messages: [new HumanMessage(request.message)],
        context: request.context ?? null,
        documentRef: request.documentRef ?? null,
      };

      const stream = app.streamEvents(initialState, streamConfig);

      for await (const event of stream) {
        if (signal?.aborted) break;

        const nodeName = (event.metadata as Record<string, unknown> | undefined)?.langgraph_node;

        if (event.event === "on_chat_model_start") {
          if (nodeName && nodeName !== "supervisor") {
            continue;
          }
          if (hasStartedSegment && currentSegmentContent.trim()) {
            callbacks.onMessageStart?.();
            currentSegmentContent = "";
          }
          hasStartedSegment = true;
        } else if (event.event === "on_chat_model_stream") {
          // Only stream tokens from the supervisor node; subgraph LLM calls
          // (leaf_extract, merge_trees, text_extract, analyze, etc.) are internal.
          if (nodeName && nodeName !== "supervisor") {
            continue;
          }
          const chunk = event.data?.chunk;
          const token = extractTextContent(chunk?.content);
          if (token) {
            fullContent += token;
            currentSegmentContent += token;
            callbacks.onToken(token);
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

      // Phase 1: Memory extraction framework is ready but extraction is manual only.
      // Phase 2: Will trigger LLM-based automatic extraction here.
      void (async () => {
        if (this.aiService.memoryExtractor && request.context?.filePath) {
          try {
            const messages = await this.aiService.checkpointer.getMessages(request.threadId)
            const summary = request.context?.mindmapSummary || ''
            await this.aiService.memoryExtractor.extractAndPersist(messages, summary, request.context.filePath)
          } catch (e) {
            logger.warn('[Orchestrator] Memory extraction failed:', e)
          }
        }
      })()
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
      const result = (await app.invoke(
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
      )) as PalaceSubgraphStateType;

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
  buildGraph(_ctx?: MindmapContextData) {
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
    if (this.options.cacheManager) {
      tools.push(
        createSearchLinkedDocumentTool({
          documents: () => this.activeContext?.linkedDocuments ?? [],
          cacheManager: this.options.cacheManager,
        }),
      );
    }
    const toolNode = new ToolNode(tools);
    const invokeSubgraph = async <T extends { messages?: BaseMessage[] }>(
      subgraph: { invoke: (state: MainGraphStateType, config: { recursionLimit: number }) => Promise<T> },
      state: MainGraphStateType,
    ): Promise<Partial<MainGraphStateType>> => {
      const result = await subgraph.invoke(state, {
        recursionLimit: AGENT_LIMITS.recursionLimit,
      });
      const { messages: _, ...updates } = result as MainGraphStateType & T;
      return updates as Partial<MainGraphStateType>;
    };

    const mindmapSubgraphNode = async (state: MainGraphStateType) =>
      invokeSubgraph(this.getCompiledMindmapSubgraph(), state);

    const palaceSubgraphNode = async (state: MainGraphStateType) =>
      invokeSubgraph(this.getCompiledPalaceSubgraph(), state);

    // 工具执行节点：过滤掉虚拟子图路由工具（已在 supervisor.invoke 中处理）
    const toolsNode = async (state: MainGraphStateType) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage && lastMessage.type === "ai") {
        const msg = lastMessage as AIMessage;
        const actionToolCalls =
          msg.tool_calls?.filter((tc) => !isVirtualSubgraphTool(tc.name)) ?? [];
        if (actionToolCalls.length === 0) {
          return { messages: [] };
        }
        const filteredState = {
          ...state,
          messages: [
            ...state.messages.slice(0, -1),
            new AIMessage({
              content: msg.content,
              tool_calls: actionToolCalls,
            }),
          ],
        };
        const result = await toolNode.invoke(filteredState);
        const messages = result.messages ?? result;
        return { messages: Array.isArray(messages) ? messages : [messages] };
      }
      const result = await toolNode.invoke(state);
      const messages = result.messages ?? result;
      return { messages: Array.isArray(messages) ? messages : [messages] };
    };

    const mindmapToolResultNode = async (state: MainGraphStateType) => {
      const content = state.error
        ? {
            ok: false,
            error: state.response || state.error,
          }
        : {
            ok: true,
            title: state.mindmapTitle,
            yamlFragment: state.mindmapYaml,
            documentRef: state.documentRef,
          };

      return {
        messages: [
          new ToolMessage({
            tool_call_id: state.pendingSubgraphToolCallId,
            name: state.pendingSubgraphToolName || GENERATE_MINDMAP_FRAGMENT_TOOL,
            content: JSON.stringify(content),
          }),
        ],
        pendingSubgraph: null,
        pendingSubgraphToolCallId: '',
        pendingSubgraphToolName: '',
      };
    };

    const palaceToolResultNode = async (state: MainGraphStateType) => {
      let imageUrl = "";
      if (!state.error && state.imageUrls.length > 0) {
        const url = state.imageUrls[0]!;
        try {
          imageUrl = url.startsWith("data:") ? url : await urlToDataUrl(url);
        } catch {
          imageUrl = url;
        }
      }

      const content = state.error
        ? {
            ok: false,
            error: state.response || state.error,
          }
        : {
            ok: true,
            label: state.palace?.theme || `记忆宫殿 (${state.memoryRoute.length} 站)`,
            stations: state.memoryRoute.map((s: MemoryPalaceStation) => ({
              order: s.order,
              content: s.content,
              anchorVisual: s.anchorVisual ?? "",
              association: s.association,
              x: s.x,
              y: s.y,
              linkedNodeId: s.linkedNodeId ?? "",
            })),
            imageUrl,
            sourceNodeIds: state.palaceInputNodes.map((n) => n.id),
          };

      return {
        messages: [
          new ToolMessage({
            tool_call_id: state.pendingSubgraphToolCallId,
            name: state.pendingSubgraphToolName || GENERATE_PALACE_TOOL,
            content: JSON.stringify(content),
          }),
        ],
        pendingSubgraph: null,
        pendingSubgraphToolCallId: '',
        pendingSubgraphToolName: '',
      };
    };

    const supervisor = new MindLaneAgent(
      this.provider,
      tools,
      { hasEmbeddings: false, hasPalace },
      this.aiService.memoryManager,
    );

    // 统一路由函数：MindLaneAgent.route() 已处理无 palace 时的回退
    const routeFn = (state: MainGraphStateType) => supervisor.route(state);

    // 统一 graph 结构：始终包含 palaceSubgraph 节点
    // hasPalace=false 时子图仍会被编译但永远不会被执行（route() 已保证）
    const graph = new StateGraph(MainGraphState)
      .addNode("supervisor", (state) => supervisor.invoke(state))
      .addNode("tools", toolsNode)
      .addNode("mindmapSubgraph", mindmapSubgraphNode)
      .addNode("palaceSubgraph", palaceSubgraphNode)
      .addNode("mindmapToolResult", mindmapToolResultNode)
      .addNode("palaceToolResult", palaceToolResultNode)
      .addEdge(START, "supervisor")
      .addConditionalEdges("supervisor", routeFn, {
        tools: "tools",
        mindmapSubgraph: "mindmapSubgraph",
        palaceSubgraph: "palaceSubgraph",
        __end__: END,
      })
      .addEdge("mindmapSubgraph", "mindmapToolResult")
      .addEdge("mindmapToolResult", "supervisor")
      .addEdge("palaceSubgraph", "palaceToolResult")
      .addEdge("palaceToolResult", "supervisor")
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
    const messages = this.extractCurrentTurnAssistantMessages(result.messages);

    const response: ChatResponse = {
      content: rawContent,
      messages,
      toolCalls: this.extractToolCalls(result.messages),
    };

    // Mindmap data now flows through YAML → batchAddMindmapNodes tool calls
    // The insertion is handled by the tool execution in the supervisor loop

    if (result.memoryRoute.length > 0) {
      response.palaceData = {
        content: rawContent,
        imageUrls: result.imageUrls,
        memoryRoute: result.memoryRoute,
      };
    }

    return response;
  }

  private extractCurrentTurnAssistantMessages(
    messages: BaseMessage[],
  ): ChatResponse["messages"] {
    const lastHumanIndex = messages.findLastIndex((m: BaseMessage) => m.type === "human");
    const currentTurnMessages =
      lastHumanIndex >= 0 ? messages.slice(lastHumanIndex + 1) : messages;
    const sessionMessages = checkpointMessagesToSessionMessages(currentTurnMessages);
    const assistantMessages = sessionMessages.filter(
      (msg): msg is AssistantMessage => msg.role === "assistant",
    );
    return assistantMessages.length > 0 ? assistantMessages : undefined;
  }

  private extractToolCalls(messages: BaseMessage[]): ChatResponse["toolCalls"] {
    const toolCalls: ChatResponse["toolCalls"] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === "human") break;
      if (msg.type === "tool") {
        const toolMsg = msg as BaseMessage & {
          name?: string;
          content: unknown;
        };
        toolCalls.unshift({
          name: toolMsg.name ?? "unknown",
          args: {},
          result:
            typeof toolMsg.content === "string"
              ? toolMsg.content
              : JSON.stringify(toolMsg.content),
        });
      }
    }
    return toolCalls.length > 0 ? toolCalls : undefined;
  }

}
