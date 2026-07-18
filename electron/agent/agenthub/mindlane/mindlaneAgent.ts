import {
  AIMessage,
  SystemMessage,
  RemoveMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { LLMProvider } from '../../providers/index.js'
import type { MainGraphStateType } from '../../state.js'
import { BaseAgent } from '../base.js'
import { ContextBuilder } from './context.js'
import { extractTextContent, formatAgentError, sanitizeAIMessageContent } from '../../utils.js'
import { MemoryManager } from '../../memory/memoryManager.js'
import { logger } from '../../../shared/logger.js'
import { ToolRegistry } from '../../tools/registry.js'
import { detect as detectSubgraphCall, isSubgraphCall } from '../../subgraphRouter.js'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'
import { isPromptTooLongError } from '../../memory/contextCompact.js'
import { AGENT_LIMITS } from '../../config.js'
import {
  preprocessMessages,
  mergeMessagePipelineConfig,
  type MessagePipelineConfig,
} from '../../context/pipeline.js'

const log = logger.withContext('MindLaneAgent')

type AIMessageContent = AIMessage['content']

/**
 * MindLaneAgent - The central agent responsible for routing decisions and context management.
 *
 * Architectural responsibilities:
 * 1. Context management: uses ContextBuilder to generate XML-format system prompts.
 * 2. Subgraph routing: decides whether to enter the mindmap/palace subgraphs via virtual tools.
 * 3. Tool invocation: manages knowledge-base search, mindmap operations, and other tools.
 * 4. Direct responses: handles ordinary conversations.
 *
 * Memory and state:
 * - The only agent with access to persistent memory.
 * - Accesses workspace, mindmap, selected nodes, and other context through state.context.
 */
export interface CapabilityFlags {
  hasEmbeddings: boolean
  hasPalace: boolean
}

interface MindLaneAgentOptions {
  userDataPath?: string
  messagePipeline?: MessagePipelineConfig
}

export class MindLaneAgent extends BaseAgent {
  private toolRegistry: ToolRegistry
  private capabilityFlags: CapabilityFlags
  private modelWithTools: ReturnType<NonNullable<BaseChatModel['bindTools']>>
  private memoryManager?: MemoryManager
  private userDataPath?: string
  private messagePipelineConfig: MessagePipelineConfig

  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    capabilityFlags?: CapabilityFlags,
    memoryManager?: MemoryManager,
    options?: MindLaneAgentOptions,
  ) {
    super(provider)
    this.toolRegistry = toolRegistry
    this.capabilityFlags = capabilityFlags ?? { hasEmbeddings: true, hasPalace: true }
    this.modelWithTools = this.provider.reasoningModel.bindTools!(this.toolRegistry.allTools)
    this.memoryManager = memoryManager
    this.userDataPath = options?.userDataPath
    this.messagePipelineConfig = mergeMessagePipelineConfig(options?.messagePipeline)
  }

  async invoke(state: MainGraphStateType): Promise<Partial<MainGraphStateType>> {
    log.info('invoke called with %d messages', state.messages.length)
    // Surface subgraph errors
    if (state.error) {
      return {
        messages: [new AIMessage({ content: state.response || state.error })],
        pendingSubgraph: null,
        response: state.response || state.error,
        error: '',
      }
    }

    try {
      const preprocessedMessages = await preprocessMessages(
        state.messages,
        this.messagePipelineConfig,
        this.userDataPath,
      )

      const builder = new ContextBuilder()
        .withMessages(preprocessedMessages)
        .withContext(state.context ?? undefined)
        .withCapabilityFlags(this.capabilityFlags)
        .withMemory(this.memoryManager)

      await builder.buildMemoryContext()
      builder.buildSystemPrompt().buildEnvironmentPrompt().buildMindmapContext()

      const systemPrompt = builder.build()

      return await this.invokeModel(state, systemPrompt, preprocessedMessages, 0)
    } catch (err) {
      const formatted = formatAgentError(err)
      log.error('invoke failed:\n', formatted)
      return {
        messages: [new AIMessage({ content: '处理请求时出错，请稍后重试。' })],
        error: formatted,
        response: '处理请求时出错，请稍后重试。',
      }
    }
  }

  route(state: MainGraphStateType): string {
    switch (state.pendingSubgraph) {
      case 'palace':
        return this.capabilityFlags.hasPalace ? 'palaceSubgraph' : '__end__'
      case 'mindmap':
        return 'mindmapSubgraph'
      default: {
        const lastMessage = state.messages[state.messages.length - 1]
        if (lastMessage && lastMessage.type === 'ai') {
          const msg = lastMessage as AIMessage
          if ((msg.tool_calls?.length ?? 0) > 0) {
            return 'tools'
          }
        }
        return '__end__'
      }
    }
  }

  private async invokeModel(
    state: MainGraphStateType,
    systemPrompt: string,
    preprocessedMessages: BaseMessage[],
    retryCount: number,
  ): Promise<Partial<MainGraphStateType>> {
    log.info('invokeModel called with %d messages', state.messages.length)
    const messagesWithSystem = [new SystemMessage(systemPrompt), ...preprocessedMessages]

    // Full prompt (system + history) goes to debug — file-only, never floods the console.
    log.debug(
      'messages before invoke:',
      JSON.stringify(messagesWithSystem.map(summarizeMessageForLog)),
    )

    let response: AIMessage
    let didReactiveCompact = false

    try {
      response = (await this.modelWithTools.invoke(messagesWithSystem)) as AIMessage
      response.content = sanitizeAIMessageContent(response.content) as AIMessageContent
    } catch (err) {
      log.error('invoke error:', err)
      log.error(
        'invoke error messages:',
        JSON.stringify(messagesWithSystem.map(summarizeMessageForLog), null, 2),
      )
      if (!isPromptTooLongError(err) || retryCount >= AGENT_LIMITS.reactiveCompactMaxRetries) {
        throw err
      }

      log.warn(
        'Prompt too long, performing reactive compact (retry %d/%d)',
        retryCount + 1,
        AGENT_LIMITS.reactiveCompactMaxRetries,
      )

      const compactedMessages = await this.performReactiveCompact(preprocessedMessages)
      didReactiveCompact = true

      const compactedWithSystem = [new SystemMessage(systemPrompt), ...compactedMessages]

      response = (await this.modelWithTools.invoke(compactedWithSystem)) as AIMessage
      response.content = sanitizeAIMessageContent(response.content) as AIMessageContent
    }

    const content = extractTextContent(response.content)
    const toolCalls = response.tool_calls ?? []

    const subgraphCall = detectSubgraphCall(toolCalls)
    const hasActionToolCall = toolCalls.some((tc) => !isSubgraphCall(tc.name))

    // info: decision summary only; full content/args go to debug (file).
    log.info(
      'model 输出: 内容 %d 字符, tool_calls=[%s], routed=%s',
      content.length,
      toolCalls.map((tc) => tc.name).join(', '),
      subgraphCall?.subgraph ?? 'none',
    )
    log.debug('model 输出全量:', {
      rawContent: summarizeMessageContent(response.content),
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      })),
      routedSubgraph: subgraphCall?.subgraph ?? null,
      hasActionToolCall,
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

    if (hasActionToolCall) {
      return { messages: resultMessages }
    }

    const virtualRoute = subgraphCall
    if (virtualRoute) {
      const routeState = {
        messages: [createToolCallMessage(response, content)],
        pendingSubgraph: virtualRoute.subgraph,
        pendingSubgraphToolCallId: virtualRoute.toolCallId,
        pendingSubgraphToolName: virtualRoute.toolName,
        response: content,
      }
      if (didReactiveCompact) {
        return { ...routeState, messages: resultMessages }
      }
      return routeState
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
      log.warn('Reactive summary failed, trimming to tail:', err)
      return messages.slice(-AGENT_LIMITS.reactiveCompactTailMessages)
    }
  }
}

function summarizeMessageContent(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content

  return content.map((block) => {
    if (!block || typeof block !== 'object') return block

    const record = block as Record<string, unknown>
    if (record.type === 'text') {
      return {
        type: record.type,
        text: record.text,
      }
    }

    if (record.type === 'tool_use') {
      return {
        type: record.type,
        id: record.id,
        name: record.name,
        input: record.input,
      }
    }

    return record
  })
}

function summarizeForLog(content: unknown): unknown {
  if (typeof content === 'string') return content.slice(0, 300)
  if (Array.isArray(content)) {
    return content.map((block) =>
      typeof block === 'string'
        ? block.slice(0, 100)
        : (JSON.stringify(block)?.slice(0, 200) ?? ''),
    )
  }
  return JSON.stringify(content)?.slice(0, 300) ?? ''
}

function summarizeMessageForLog(message: BaseMessage) {
  const msgWithTools = message as BaseMessage & {
    tool_call_id?: string
    tool_calls?: Array<{ id?: string; name?: string }>
  }

  return {
    type: message.getType(),
    content: summarizeForLog(message.content),
    tool_call_id: msgWithTools.tool_call_id,
    tool_calls: msgWithTools.tool_calls?.map((tc) => ({ id: tc.id, name: tc.name })),
  }
}

function createToolCallMessage(response: AIMessage, content: string): AIMessage {
  return new AIMessage({
    content,
    tool_calls: response.tool_calls ?? [],
  })
}
