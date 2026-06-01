import { AIMessage, SystemMessage, RemoveMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMProvider } from "../../providers/index.js";
import type { MainGraphStateType } from "../../state.js";
import { BaseAgent } from "../base.js";
import { ContextBuilder } from "./context.js";
import { extractTextContent, formatAgentError } from "../../utils.js";
import { MemoryManager } from "../../memory/memoryManager.js";
import { logger } from "../../../shared/logger.js";
import {
  createGenerateMindmapFragmentTool,
  createGeneratePalaceTool,
  GENERATE_MINDMAP_FRAGMENT_TOOL,
  GENERATE_PALACE_TOOL,
  isVirtualSubgraphTool,
  type GenerateMindmapFragmentArgs,
  type GeneratePalaceArgs,
} from "../../tools/subgraphRoutingTools.js";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import { isPromptTooLongError } from "../../memory/contextCompact.js";
import { AGENT_LIMITS } from "../../config.js";

/**
 * MindLaneAgent - 中央智能体，负责路由决策和上下文管理
 *
 * 架构职责：
 * 1. 上下文管理：使用 ContextBuilder 生成 XML 格式的系统 prompt
 * 2. 子图路由：通过虚拟工具决定是否进入 mindmap/palace 子图
 * 3. 工具调用：管理知识库搜索、思维导图操作等工具
 * 4. 直接响应：处理普通对话
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
  private memoryManager?: MemoryManager;

  constructor(
    provider: LLMProvider,
    tools: StructuredToolInterface[],
    capabilityFlags?: CapabilityFlags,
    memoryManager?: MemoryManager,
  ) {
    super(provider);
    const routingTools: StructuredToolInterface[] = [
      createGenerateMindmapFragmentTool(),
    ];
    if (capabilityFlags?.hasPalace ?? true) {
      routingTools.push(createGeneratePalaceTool());
    }
    this.tools = [...tools, ...routingTools];
    this.capabilityFlags = capabilityFlags ?? { hasEmbeddings: true, hasPalace: true };
    this.modelWithTools = this.provider.reasoningModel.bindTools!(this.tools);
    this.memoryManager = memoryManager;
  }

  async invoke(
    state: MainGraphStateType,
  ): Promise<Partial<MainGraphStateType>> {
    // Surface subgraph errors
    if (state.error) {
      return {
        messages: [new AIMessage({ content: state.response || state.error })],
        pendingSubgraph: null,
        response: state.response || state.error,
        error: '',
      };
    }

    try {
      const builder = new ContextBuilder()
        .withMessages(state.messages)
        .withContext(state.context ?? undefined)
        .withCapabilityFlags(this.capabilityFlags)
        .withMemory(this.memoryManager)

      await builder.buildMemoryContext()
      builder.buildSystemPrompt()
        .buildEnvironmentPrompt()
        .buildMindmapContext()
        .buildHistory()

      const systemPrompt = builder.build();

      return await this.invokeModel(state, systemPrompt, 0)
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
      const actionToolCalls =
        msg.tool_calls?.filter((tc) => !isVirtualSubgraphTool(tc.name)) ?? [];
      if (actionToolCalls.length > 0) {
        return "tools";
      }
    }

    switch (state.pendingSubgraph) {
      case "palace":
        return this.capabilityFlags.hasPalace ? "palaceSubgraph" : "__end__";
      case "mindmap":
        return "mindmapSubgraph";
      default:
        return "__end__";
    }
  }

  private async invokeModel(
    state: MainGraphStateType,
    systemPrompt: string,
    retryCount: number,
  ): Promise<Partial<MainGraphStateType>> {
    const messagesWithSystem = [
      new SystemMessage(systemPrompt),
      ...state.messages,
    ];

    let response: AIMessage
    let didReactiveCompact = false

    try {
      response = (await this.modelWithTools.invoke(messagesWithSystem)) as AIMessage
    } catch (err) {
      if (!isPromptTooLongError(err) || retryCount >= AGENT_LIMITS.reactiveCompactMaxRetries) {
        throw err
      }

      logger.warn(
        '[MindLaneAgent] Prompt too long, performing reactive compact (retry %d/%d)',
        retryCount + 1,
        AGENT_LIMITS.reactiveCompactMaxRetries,
      )

      const compactedMessages = await this.performReactiveCompact(state.messages)
      didReactiveCompact = true

      const compactedWithSystem = [
        new SystemMessage(systemPrompt),
        ...compactedMessages,
      ]

      response = (await this.modelWithTools.invoke(compactedWithSystem)) as AIMessage
    }

    const content = extractTextContent(response.content)
    const toolCalls = response.tool_calls ?? []

    const virtualToolCalls = toolCalls.filter((tc) =>
      isVirtualSubgraphTool(tc.name),
    )
    const actionToolCalls = toolCalls.filter((tc) =>
      !isVirtualSubgraphTool(tc.name),
    )

    logger.info('[MindLaneAgent] 模型输出:', {
      rawContent: summarizeMessageContent(response.content),
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      })),
      actionToolCalls: actionToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      })),
    })

    let resultMessages: BaseMessage[]
    if (didReactiveCompact) {
      const compactedMessages = await this.performReactiveCompact(state.messages)
      resultMessages = [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...compactedMessages,
        response,
      ]
    } else {
      resultMessages = [response]
    }

    if (actionToolCalls.length > 0) {
      return { messages: resultMessages }
    }

    const virtualToolCall = virtualToolCalls[0]
    if (virtualToolCall) {
      const routeResult = this.executeVirtualToolRoute(response, virtualToolCall, content)
      if (didReactiveCompact) {
        return { ...routeResult, messages: resultMessages }
      }
      return routeResult
    }

    return {
      messages: resultMessages,
      pendingSubgraph: null,
      response: content,
    }
  }

  private async performReactiveCompact(messages: BaseMessage[]): Promise<BaseMessage[]> {
    try {
      const summaryPrompt = new SystemMessage(
        '请用中文简要总结以下对话的关键信息。保留：1）用户的主要目标，2）关键事实和约束，3）最近待继续的任务。保持简短具体。',
      )

      const summaryResponse = await this.provider.reasoningModel.invoke([
        summaryPrompt,
        ...messages,
        new HumanMessage('请总结以上对话。'),
      ])

      const summary = extractTextContent(summaryResponse.content)
      const summaryMsg = new AIMessage({ content: `[Reactive compact] ${summary}` })
      const tailMessages = messages.slice(-AGENT_LIMITS.reactiveCompactTailMessages)

      return [summaryMsg, ...tailMessages]
    } catch (err) {
      logger.warn('[MindLaneAgent] Reactive summary failed, trimming to tail:', err)
      return messages.slice(-AGENT_LIMITS.reactiveCompactTailMessages)
    }
  }

  private executeVirtualToolRoute(
    response: AIMessage,
    toolCall: NonNullable<AIMessage["tool_calls"]>[number],
    content: string,
  ): Partial<MainGraphStateType> {
    if (toolCall.name === GENERATE_MINDMAP_FRAGMENT_TOOL) {
      const args = toolCall.args as GenerateMindmapFragmentArgs;
      const source = args.source;
      if (!source) {
        return {
          messages: [new AIMessage({ content: '请提供要生成思维导图的文档或文本。' })],
          pendingSubgraph: null,
          response: '请提供要生成思维导图的文档或文本。',
        };
      }
      return {
        messages: [createToolCallMessage(response, content)],
        pendingSubgraph: "mindmap",
        pendingSubgraphToolCallId: toolCall.id ?? '',
        pendingSubgraphToolName: toolCall.name,
        mindmapInputSource: source,
        mindmapInputTitle: args.title || '',
        response: content,
      };
    }

    if (toolCall.name === GENERATE_PALACE_TOOL) {
      const args = toolCall.args as GeneratePalaceArgs;
      return {
        messages: [createToolCallMessage(response, content)],
        pendingSubgraph: "palace",
        pendingSubgraphToolCallId: toolCall.id ?? '',
        pendingSubgraphToolName: toolCall.name,
        palaceInputText: args.inputText || content,
        palaceInputNodes: args.inputNodes || [],
        response: content,
      };
    }

    return {
      messages: [response],
      pendingSubgraph: null,
      response: content,
    };
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

function createToolCallMessage(response: AIMessage, content: string): AIMessage {
  return new AIMessage({
    content,
    tool_calls: response.tool_calls ?? [],
  });
}
