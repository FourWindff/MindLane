import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import type { LLMProvider } from "../../providers/index.js";
import type { MainGraphStateType } from "../../state.js";
import { BaseAgent } from "../base.js";
import { ContextBuilder } from "./context.js";
import { extractTextContent } from "../../utils.js";
import {
  createRouteDecisionTool,
  type RouteDecision,
} from "../../tools/routeDecisionTool.js";

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
  private modelWithTools: ReturnType<BaseLanguageModelInterface["bindTools"]>;

  constructor(
    provider: LLMProvider,
    tools: StructuredToolInterface[],
    userProfile?: string,
    capabilityFlags?: CapabilityFlags,
  ) {
    super(provider);
    const routeTool = createRouteDecisionTool(capabilityFlags?.hasPalace ?? true);
    this.tools = [...tools, routeTool];
    // ToolNode 只包含原始工具，路由决策工具在 invoke() 中直接处理
    this.toolNode = new ToolNode(tools);
    this.userProfile = userProfile;
    this.capabilityFlags = capabilityFlags ?? { hasEmbeddings: true, hasPalace: true };
    this.modelWithTools = this.provider.reasoningModel.bindTools!(this.tools);
  }

  async invoke(
    state: MainGraphStateType,
  ): Promise<Partial<MainGraphStateType>> {
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

    const response = await this.modelWithTools.invoke(messagesWithSystem);
    const content = extractTextContent(response.content);
    const toolCalls = (response as AIMessage).tool_calls ?? [];

    const routeToolName = this.tools[this.tools.length - 1].name;
    const nonRouteToolCalls = toolCalls.filter(
      (tc) => tc.name !== routeToolName,
    );

    if (nonRouteToolCalls.length > 0) {
      return { messages: [response] };
    }

    const routeToolCall = toolCalls.find((tc) => tc.name === routeToolName);
    if (routeToolCall) {
      const decision = routeToolCall.args as RouteDecision;
      return this.executeRouteDecision(response, decision, content);
    }

    return {
      messages: [response],
      intent: "qa",
      response: content,
    };
  }

  async invokeTools(
    state: MainGraphStateType,
  ): Promise<Partial<MainGraphStateType>> {
    // 过滤掉路由决策工具的调用，它已在 invoke() 中直接处理
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && lastMessage._getType() === "ai") {
      const msg = lastMessage as AIMessage;
      const routeToolName = this.tools[this.tools.length - 1].name;
      const nonRouteToolCalls =
        msg.tool_calls?.filter((tc) => tc.name !== routeToolName) ?? [];
      if (nonRouteToolCalls.length === 0) {
        return { messages: [] };
      }
      // 创建只包含非路由工具的临时状态给 ToolNode
      const filteredState = {
        ...state,
        messages: [
          ...state.messages.slice(0, -1),
          new AIMessage({
            content: msg.content,
            tool_calls: nonRouteToolCalls,
          }),
        ],
      };
      const result = await this.toolNode.invoke(filteredState);
      const messages = result.messages ?? result;
      return { messages: Array.isArray(messages) ? messages : [messages] };
    }

    const result = await this.toolNode.invoke(state);
    const messages = result.messages ?? result;
    return { messages: Array.isArray(messages) ? messages : [messages] };
  }

  route(state: MainGraphStateType): string {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage && lastMessage._getType() === "ai") {
      const msg = lastMessage as AIMessage;
      const routeToolName = this.tools[this.tools.length - 1].name;
      const nonRouteToolCalls =
        msg.tool_calls?.filter((tc) => tc.name !== routeToolName) ?? [];
      if (nonRouteToolCalls.length > 0) {
        return "tools";
      }
    }

    if (lastMessage && lastMessage._getType() === "tool") {
      return "supervisor";
    }

    switch (state.intent) {
      case "palace":
        return "palaceSubgraph";
      case "mindmap":
        return "mindmapSubgraph";
      default:
        return "__end__";
    }
  }

  private executeRouteDecision(
    response: AIMessage,
    decision: RouteDecision,
    content: string,
  ): Partial<MainGraphStateType> {
    switch (decision.target) {
      case "mindmap":
        return {
          messages: [response],
          intent: "mindmap",
          mindmapInputText: decision.parameters?.mindmapInput || content,
          mindmapInputTitle: decision.parameters?.mindmapTitle || undefined,
          response: content,
        };
      case "palace":
        return {
          messages: [response],
          intent: "palace",
          palaceInputText: decision.parameters?.palaceInput || content,
          response: content,
        };
      case "qa":
      default:
        return {
          messages: [response],
          intent: "qa",
          response: content,
        };
    }
  }
}
