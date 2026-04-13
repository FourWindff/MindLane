import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { LLMProvider } from "../../providers/index.js";
import type {
  GeneratedNode,
  GeneratedEdge,
  MainGraphStateType,
} from "../../state.js";
import { BaseAgent } from "../base.js";
import { buildExtractStructureMessages } from "../prompts/docToMindmap.js";
import { ContextBuilder, ContextTemplates } from "./context.js";

/**
 * 知识结构树节点
 */
interface KeyPoint {
  title: string;
  children?: KeyPoint[];
}

/**
 * 路由决定 Schema - 使用 Zod 定义结构化输出
 */
const RouteDecisionSchema = z.object({
  /** 路由目标 */
  target: z.enum(["qa", "mindmap", "palace"]),
  /** 原因说明 */
  reason: z.string().optional(),
  /** 附带的参数 */
  parameters: z
    .object({
      /** 思维导图生成的输入内容 */
      mindmapInput: z.string().optional(),
      /** 思维导图标题 */
      mindmapTitle: z.string().optional(),
      /** 记忆宫殿的输入内容 */
      palaceInput: z.string().optional(),
    })
    .optional(),
});

type RouteDecision = z.infer<typeof RouteDecisionSchema>;

/**
 * 从 LangChain message content 中提取文本
 * Anthropic 格式返回 content 是数组 [{type:"text", text:"..."}]
 * OpenAI 格式返回 content 是字符串
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text" &&
          "text" in block,
      )
      .map((block) => block.text)
      .join("");
  }
  return "";
}

/**
 * 递归扁平化树形结构为节点和边
 */
function flattenTree(
  points: KeyPoint[],
  parentId: string,
  genId: (prefix: string) => string,
): { nodes: GeneratedNode[]; edges: GeneratedEdge[] } {
  const nodes: GeneratedNode[] = [];
  const edges: GeneratedEdge[] = [];

  for (const point of points) {
    const nodeId = genId("topic");
    nodes.push({
      id: nodeId,
      type: "topic",
      data: { label: point.title },
    });
    edges.push({
      id: `e-${parentId}-${nodeId}`,
      source: parentId,
      target: nodeId,
      type: "smoothstep",
    });

    if (point.children && point.children.length > 0) {
      const sub = flattenTree(point.children, nodeId, genId);
      nodes.push(...sub.nodes);
      edges.push(...sub.edges);
    }
  }

  return { nodes, edges };
}

/**
 * MindLaneAgent - 中央智能体，负责路由决策和上下文管理
 *
 * 架构职责：
 * 1. 上下文管理：使用 ContextBuilder 生成 XML 格式的系统 prompt
 * 2. 路由决策：决定用户请求应该路由到 qa/mindmap/palace 哪个功能
 * 3. 工具调用：管理知识库搜索、思维导图操作等工具
 * 4. 直接响应：处理普通问答和思维导图生成
 *
 * 记忆与状态：
 * - 是唯一拥有持久化记忆访问权限的 Agent
 * - 通过 state.context 访问工作区、思维导图、选中节点等上下文
 */
export interface CapabilityFlags {
  hasEmbeddings: boolean;
  hasPalace: boolean;
}

export class MindLaneAgent extends BaseAgent {
  private toolNode: ToolNode;
  private tools: StructuredToolInterface[];
  private userProfile?: string;
  private capabilityFlags: CapabilityFlags;

  constructor(
    provider: LLMProvider,
    tools: StructuredToolInterface[],
    userProfile?: string,
    capabilityFlags?: CapabilityFlags,
  ) {
    super(provider);
    this.tools = tools;
    this.toolNode = new ToolNode(tools);
    this.userProfile = userProfile;
    this.capabilityFlags = capabilityFlags ?? { hasEmbeddings: true, hasPalace: true };
  }

  async invoke(
    state: MainGraphStateType,
  ): Promise<Partial<MainGraphStateType>> {
    // 使用 ContextBuilder 生成 XML 格式的系统 prompt
    const systemPrompt = new ContextBuilder()
      .withMessages(state.messages)
      .withContext(state.context ?? undefined)
      .withUserProfile(this.userProfile)
      .withCapabilityFlags(this.capabilityFlags)
      .buildSystemPrompt()
      .buildEnvironmentPrompt()
      .buildUserProfile()
      .buildMindmapContext()
      .buildHistory()
      .build();

    const messagesWithSystem = [
      new SystemMessage(systemPrompt),
      ...state.messages,
    ];

    // 使用带工具的模型（用于知识库搜索等）
    const modelWithTools = this.provider.reasoningModel.bindTools!(this.tools);

    const response = await modelWithTools.invoke(messagesWithSystem);
    const content = extractTextContent(response.content);
    const toolCalls = (response as AIMessage).tool_calls ?? [];

    // 优先检查是否是工具调用（知识库搜索等）
    if (toolCalls.length > 0) {
      return { messages: [response] };
    }

    // 使用结构化输出获取路由决定
    const routeDecision = await this.getRouteDecision(state);
    if (routeDecision) {
      // 根据路由决定执行相应操作
      return this.executeRouteDecision(state, response, routeDecision, content);
    }

    // 默认 QA 模式
    return {
      messages: [response],
      intent: "qa",
      response: content,
    };
  }

  /**
   * 使用 LangChain 的 withStructuredOutput 获取路由决定
   */
  private async getRouteDecision(
    state: MainGraphStateType,
  ): Promise<RouteDecision | null> {
    try {
      // 使用 withStructuredOutput 强制模型输出符合 schema 的结构化数据
      const structuredModel = this.provider.reasoningModel.withStructuredOutput(
        RouteDecisionSchema,
        {
          name: "routeDecision",
        },
      );

      // 使用路由决策专用上下文
      const systemPrompt = ContextTemplates.routeDecision(
        state.context ?? undefined,
        this.capabilityFlags,
      ).build();

      const messagesWithSystem = [
        new SystemMessage(systemPrompt),
        ...state.messages,
      ];

      const decision = await structuredModel.invoke(messagesWithSystem);
      return decision as RouteDecision;
    } catch {
      // 如果结构化输出失败，返回 null，让调用方使用默认 QA 模式
      return null;
    }
  }

  async invokeTools(
    state: MainGraphStateType,
  ): Promise<Partial<MainGraphStateType>> {
    const result = await this.toolNode.invoke(state);
    const messages = result.messages ?? result;
    return { messages: Array.isArray(messages) ? messages : [messages] };
  }

  route(state: MainGraphStateType): string {
    const lastMessage = state.messages[state.messages.length - 1];

    // ReAct 循环: 如果最后一条是 AI 的工具调用请求 → 执行工具
    if (lastMessage && lastMessage._getType() === "ai") {
      const msg = lastMessage as AIMessage;
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        return "tools";
      }
    }

    // ReAct 循环: 如果最后一条是工具执行结果 → 回到 supervisor 继续推理
    if (lastMessage && lastMessage._getType() === "tool") {
      return "supervisor";
    }

    // 根据意图路由: 只有生成记忆宫殿时才进入子图
    switch (state.intent) {
      case "palace":
        return "palaceSubgraph";
      default:
        return "__end__";
    }
  }

  /**
   * 执行路由决定 - 根据目标直接执行相应操作
   */
  private async executeRouteDecision(
    state: MainGraphStateType,
    response: AIMessage,
    decision: RouteDecision,
    content: string,
  ): Promise<Partial<MainGraphStateType>> {
    const cleanResponse = content;

    switch (decision.target) {
      case "mindmap":
        // 直接生成思维导图
        return this.generateMindmap(state, response, decision, cleanResponse);
      case "palace":
        return {
          messages: [response],
          intent: "palace",
          palaceInputText: decision.parameters?.palaceInput || cleanResponse,
          response: cleanResponse,
        };
      case "qa":
      default:
        return {
          messages: [response],
          intent: "qa",
          response: cleanResponse,
        };
    }
  }

  /**
   * 生成思维导图 - 从文本提取结构并生成节点/边
   */
  private async generateMindmap(
    _state: MainGraphStateType,
    response: AIMessage,
    decision: RouteDecision,
    content: string,
  ): Promise<Partial<MainGraphStateType>> {
    const documentText = decision.parameters?.mindmapInput || content;
    const title = decision.parameters?.mindmapTitle || "思维导图";

    if (!documentText) {
      return {
        messages: [response],
        intent: "qa",
        response: "请提供要生成思维导图的内容。",
      };
    }

    let nodeCounter = 0;
    function genId(prefix: string): string {
      return `${prefix}-${Date.now()}-${++nodeCounter}`;
    }

    try {
      const text = documentText.slice(0, 8000);
      const extractResponse = await this.provider.reasoningModel.invoke(
        buildExtractStructureMessages(text),
      );
      const extractContent = extractTextContent(extractResponse.content);

      const jsonMatch = extractContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          messages: [response],
          intent: "qa",
          error: "AI 未返回有效的 JSON 结构",
          response: "生成思维导图失败：无法解析结构",
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        title?: string;
        points?: KeyPoint[];
      };

      const finalTitle = parsed.title ?? title;
      const points = parsed.points ?? [];

      if (points.length === 0) {
        return {
          messages: [response],
          intent: "qa",
          error: "未提取到任何要点",
          response: "生成思维导图失败：未提取到任何要点",
        };
      }

      const docNodeId = genId("doc");
      const rootId = genId("root");

      const docNode: GeneratedNode = {
        id: docNodeId,
        type: "document",
        data: {
          filename: title,
          excerpt: documentText.slice(0, 200),
        },
      };

      const rootNode: GeneratedNode = {
        id: rootId,
        type: "topic",
        data: { label: finalTitle },
      };

      const docToRootEdge: GeneratedEdge = {
        id: `e-${docNodeId}-${rootId}`,
        source: docNodeId,
        target: rootId,
        type: "smoothstep",
      };

      const tree = flattenTree(points, rootId, genId);

      return {
        messages: [response],
        intent: "mindmap",
        mindmapNodes: [docNode, rootNode, ...tree.nodes],
        mindmapEdges: [docToRootEdge, ...tree.edges],
        mindmapTitle: finalTitle,
        response: `已生成思维导图「${finalTitle}」，共 ${tree.nodes.length + 2} 个节点。`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        messages: [response],
        intent: "qa",
        error: `生成思维导图失败：${errorMsg}`,
        response: `生成思维导图失败：${errorMsg}`,
      };
    }
  }
}
