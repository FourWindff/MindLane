import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMProvider } from "../../providers/index.js";
import type { MainGraphStateType, MindmapInputSource } from "../../state.js";
import { BaseAgent } from "../base.js";
import { ContextBuilder } from "./context.js";
import { extractTextContent, formatAgentError } from "../../utils.js";
import { logger } from "../../../shared/logger.js";
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
  private tools: StructuredToolInterface[];
  private capabilityFlags: CapabilityFlags;
  private modelWithTools: ReturnType<NonNullable<BaseChatModel["bindTools"]>>;

  constructor(
    provider: LLMProvider,
    tools: StructuredToolInterface[],
    capabilityFlags?: CapabilityFlags,
  ) {
    super(provider);
    const routeTool = createRouteDecisionTool(capabilityFlags?.hasPalace ?? true);
    this.tools = [...tools, routeTool];
    // ToolNode 只包含原始工具，路由决策工具在 invoke() 中直接处理
    this.capabilityFlags = capabilityFlags ?? { hasEmbeddings: true, hasPalace: true };
    this.modelWithTools = this.provider.reasoningModel.bindTools!(this.tools);
  }

  async invoke(
    state: MainGraphStateType,
  ): Promise<Partial<MainGraphStateType>> {
    // Palace fast-path: if subgraph already decided the route, skip redundant LLM call
    if (state.intent === 'palace' && state.palaceInputText && !state.memoryRoute?.length && !state.error) {
      return { messages: [] };
    }

    // Surface subgraph errors
    if (state.error) {
      return {
        messages: [new AIMessage({ content: state.response || state.error })],
        intent: 'qa',
        response: state.response || state.error,
      };
    }

    try {
      const systemPrompt = new ContextBuilder()
        .withMessages(state.messages)
        .withContext(state.context ?? undefined)
        .withCapabilityFlags(this.capabilityFlags)
        .buildSystemPrompt()
        .buildEnvironmentPrompt()
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

      logger.info('[MindLaneAgent] 模型输出:', {
        rawContent: summarizeMessageContent(response.content),
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
        })),
        nonRouteToolCalls: nonRouteToolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
        })),
      });

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
    } catch (err) {
      const formatted = formatAgentError(err);
      logger.error('[MindLaneAgent] invoke 失败:\n', formatted);
      return {
        messages: [new AIMessage({ content: '处理请求时出错，请稍后重试。' })],
        error: formatted,
        response: '处理请求时出错，请稍后重试。',
      };
    }
  }

  route(state: MainGraphStateType): string {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage && lastMessage.type === "ai") {
      const msg = lastMessage as AIMessage;
      const routeToolName = this.tools[this.tools.length - 1].name;
      const nonRouteToolCalls =
        msg.tool_calls?.filter((tc) => tc.name !== routeToolName) ?? [];
      if (nonRouteToolCalls.length > 0) {
        return "tools";
      }
    }

    switch (state.intent) {
      case "palace":
        return this.capabilityFlags.hasPalace ? "palaceSubgraph" : "__end__";
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
    // 路由决策已被本地拦截处理，不应将 routeDecision 的 tool_use/tool_calls 存入状态，
    // 否则后续模型调用会因缺少对应 tool response 而触发 API 验证错误。
    const cleanResponse = new AIMessage({ content });
    switch (decision.target) {
      case "mindmap": {
        const source = decision.parameters?.mindmapSource;
        if (source) {
          return {
            messages: [cleanResponse],
            intent: "mindmap",
            mindmapInputSource: {
              type: source.type,
              path: source.path,
              url: source.url,
            } as MindmapInputSource,
            mindmapInputTitle: decision.parameters?.mindmapTitle || undefined,
            response: content,
          };
        }
        // No external source — pure text request. Let tools handle it.
        return {
          messages: [cleanResponse],
          intent: "qa",
          response: content,
        };
      }
      case "palace":
        return {
          messages: [cleanResponse],
          intent: "palace",
          palaceInputText: decision.parameters?.palaceInput || content,
          response: content,
        };
      case "qa":
      default:
        return {
          messages: [cleanResponse],
          intent: "qa",
          response: content,
        };
    }
  }
}

function summarizeMessageContent(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;

  return content.map((block) => {
    if (!block || typeof block !== 'object') return block;

    const record = block as Record<string, unknown>;
    if (record.type === 'text') {
      return {
        type: record.type,
        text: record.text,
      };
    }

    if (record.type === 'tool_use') {
      return {
        type: record.type,
        id: record.id,
        name: record.name,
        input: record.input,
      };
    }

    return record;
  });
}
