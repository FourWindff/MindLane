import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { LLMProvider } from "../../providers/index.js";
import type { MainGraphStateType } from "../../state.js";
import { BaseAgent } from "../base.js";
import { ContextBuilder } from "./context.js";
import {
  routeDecisionTool,
  type RouteDecision,
} from "../../tools/routeDecisionTool.js";

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

const ROUTE_TOOL_NAME = "routeDecision";

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
    this.tools = [...tools, routeDecisionTool];
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

    // 使用带工具的模型（包含路由决策工具 + 普通工具）
    const modelWithTools = this.provider.reasoningModel.bindTools!(this.tools);

    const response = await modelWithTools.invoke(messagesWithSystem);
    const content = extractTextContent(response.content);
    const toolCalls = (response as AIMessage).tool_calls ?? [];

    // 分离路由工具调用与普通工具调用
    const routeToolCall = toolCalls.find((tc) => tc.name === ROUTE_TOOL_NAME);
    const nonRouteToolCalls = toolCalls.filter(
      (tc) => tc.name !== ROUTE_TOOL_NAME,
    );

    // 优先：如果有普通工具调用（搜索等），走 ToolNode ReAct 循环
    if (nonRouteToolCalls.length > 0) {
      return { messages: [response] };
    }

    // 次优：如果只有路由工具调用，直接提取决策，不走 ToolNode
    if (routeToolCall) {
      const decision = routeToolCall.args as RouteDecision;
      return this.executeRouteDecision(state, response, decision, content);
    }

    // 默认 QA 模式
    return {
      messages: [response],
      intent: "qa",
      response: content,
    };
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
      // 过滤掉路由决策工具的调用，它已在 invoke() 中直接处理
      const nonRouteToolCalls =
        msg.tool_calls?.filter((tc) => tc.name !== ROUTE_TOOL_NAME) ?? [];
      if (nonRouteToolCalls.length > 0) {
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
  private executeRouteDecision(
    _state: MainGraphStateType,
    response: AIMessage,
    decision: RouteDecision,
    content: string,
  ): Promise<Partial<MainGraphStateType>> {
    const cleanResponse = content;

    switch (decision.target) {
      case "mindmap":
        // 设置意图和输入，由子图负责生成
        return Promise.resolve({
          messages: [response],
          intent: "mindmap",
          mindmapInputText: decision.parameters?.mindmapInput || cleanResponse,
          mindmapInputTitle: decision.parameters?.mindmapTitle || undefined,
          response: cleanResponse,
        });
      case "palace":
        return Promise.resolve({
          messages: [response],
          intent: "palace",
          palaceInputText: decision.parameters?.palaceInput || cleanResponse,
          response: cleanResponse,
        });
      case "qa":
      default:
        return Promise.resolve({
          messages: [response],
          intent: "qa",
          response: cleanResponse,
        });
    }
  }
}
