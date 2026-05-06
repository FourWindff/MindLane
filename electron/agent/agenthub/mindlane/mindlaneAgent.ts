import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { LLMProvider } from "../../providers/index.js";
import type { MainGraphStateType } from "../../state.js";
import { BaseAgent } from "../base.js";
import { ContextBuilder, ContextTemplates } from "./context.js";

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

    // 根据意图路由到对应子图
    switch (state.intent) {
      case "palace":
        return "palaceSubgraph";
      case "mindmap":
        return "mindmapSubgraph";
      default:
        return "__end__";
    }
  }

  /**
   * 执行路由决定 - 根据目标直接执行相应操作
   */
  private async executeRouteDecision(
    _state: MainGraphStateType,
    response: AIMessage,
    decision: RouteDecision,
    content: string,
  ): Promise<Partial<MainGraphStateType>> {
    const cleanResponse = content;

    switch (decision.target) {
      case "mindmap":
        // 设置意图和输入，由子图负责生成
        return {
          messages: [response],
          intent: "mindmap",
          mindmapInputText: decision.parameters?.mindmapInput || cleanResponse,
          mindmapInputTitle: decision.parameters?.mindmapTitle || undefined,
          response: cleanResponse,
        };
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
}
