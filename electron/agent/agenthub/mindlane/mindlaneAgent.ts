import { AIMessage, SystemMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { LLMProvider } from '../../providers/index.js'
import type { MainGraphStateType } from '../../state.js'
import { BaseAgent } from '../base.js'
import { buildSystemPrompt } from './context.js'
import { extractTextContent, formatAgentError, sanitizeAIMessageContent } from '../../utils.js'
import { MemoryManager } from '../../memory/memoryManager.js'
import { logger } from '../../../shared/logger.js'
import { ToolRegistry } from '../../tools/registry.js'
import {
  detect as detectSubgraphCall,
  isSubgraphCall,
  type SubgraphName,
} from '../../subgraphRouter.js'
import { REMOVE_ALL_MESSAGES, Send } from '@langchain/langgraph'
import { isPromptTooLongError, trimToRecentWindow } from '../../memory/contextCompact.js'
import { AGENT_LIMITS } from '../../config.js'
import {
  prepareMessagesForModel,
  mergeMessagePreparationConfig,
  type MessagePreparationConfig,
} from '../../context/messagePreparation.js'

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
interface MindLaneAgentOptions {
  userDataPath?: string
  messagePipeline?: MessagePreparationConfig
}

export class MindLaneAgent extends BaseAgent {
  private toolRegistry: ToolRegistry
  private modelWithTools: ReturnType<NonNullable<BaseChatModel['bindTools']>>
  private memoryManager?: MemoryManager
  private userDataPath?: string
  private messagePipelineConfig: MessagePreparationConfig

  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    memoryManager?: MemoryManager,
    options?: MindLaneAgentOptions,
  ) {
    super(provider)
    this.toolRegistry = toolRegistry
    this.modelWithTools = this.provider.model.bindTools!(this.toolRegistry.allTools)
    this.memoryManager = memoryManager
    this.userDataPath = options?.userDataPath
    this.messagePipelineConfig = mergeMessagePreparationConfig(
      options?.messagePipeline,
      provider.contextWindow,
    )
  }

  async invoke(state: MainGraphStateType): Promise<Partial<MainGraphStateType>> {
    log.info('invoke called with %d messages', state.messages.length)
    // Surface subgraph errors / supervisor errors: whoever failed already wrote the
    // user-facing text, so end the turn with that text instead of calling the model.
    const failureText =
      (state.mindmapError && (state.mindmapResponse || state.mindmapError)) ||
      (state.palaceError && (state.palaceResponse || state.palaceError)) ||
      (state.error && (state.response || state.error))
    if (failureText) {
      return {
        messages: [new AIMessage({ content: failureText })],
        pendingSubgraphs: [],
        response: failureText,
        mindmapError: '',
        palaceError: '',
        error: '',
      }
    }

    try {
      const preprocessedMessages = await prepareMessagesForModel(
        state.messages,
        this.messagePipelineConfig,
        this.userDataPath,
      )

      const systemPrompt = await buildSystemPrompt({
        context: state.context ?? undefined,
        memoryManager: this.memoryManager,
        lastSummary: state.summary || undefined,
      })

      return await this.invokeModel(state, systemPrompt, preprocessedMessages)
    } catch (err) {
      const formatted = formatAgentError(err)
      log.error('invoke failed:\n', formatted)
      return {
        messages: [new AIMessage({ content: '处理请求时出错，请稍后重试。' })],
        error: formatted,
        response: '处理请求时出错，请稍后重试。',
        pendingSubgraphs: [],
      }
    }
  }

  /**
   * Conditional-edge router.
   *
   * Every declared call is dispatched, and dispatch is per call: plain tool
   * calls go to the tools node as one `Send` each (ToolNode executes exactly
   * the call it is handed), each pending subgraph goes to its own node. Several
   * destinations mean one super-step, so two subgraphs — or a tool and a
   * subgraph — run in parallel.
   *
   * `pendingSubgraphs` is a supervisor-owned key: this node sets it when the
   * model declares subgraph calls and clears it on every other path, and no
   * subgraph node writes it — so a consumed declaration can never re-route the
   * graph back into a subgraph that already ran.
   */
  route(state: MainGraphStateType): Array<string | Send> {
    const destinations: Array<string | Send> = []
    const lastMessage = state.messages[state.messages.length - 1]
    if (lastMessage && lastMessage.type === 'ai') {
      for (const toolCall of (lastMessage as AIMessage).tool_calls ?? []) {
        if (!isSubgraphCall(toolCall.name)) {
          destinations.push(new Send('tools', { ...state, lg_tool_call: toolCall }))
        }
      }
    }

    for (const subgraph of state.pendingSubgraphs) {
      destinations.push(subgraph === 'palace' ? 'palaceSubgraph' : 'mindmapSubgraph')
    }

    return destinations.length > 0 ? destinations : ['__end__']
  }

  private async invokeModel(
    state: MainGraphStateType,
    systemPrompt: string,
    preprocessedMessages: BaseMessage[],
  ): Promise<Partial<MainGraphStateType>> {
    log.info('invokeModel called with %d messages', state.messages.length)
    const messagesWithSystem = [new SystemMessage(systemPrompt), ...preprocessedMessages]

    // Full prompt (system + history) goes to debug — file-only, never floods the console.
    log.debug(
      'messages before invoke:',
      JSON.stringify(messagesWithSystem.map(summarizeMessageForLog)),
    )

    let response: AIMessage
    let didTrim = false
    let trimmedMessages: BaseMessage[] = []

    try {
      response = (await this.modelWithTools.invoke(messagesWithSystem)) as AIMessage
      response.content = sanitizeAIMessageContent(response.content) as AIMessageContent
    } catch (err) {
      log.error('invoke error:', err)
      log.error(
        'invoke error messages:',
        JSON.stringify(messagesWithSystem.map(summarizeMessageForLog), null, 2),
      )
      if (!isPromptTooLongError(err)) {
        throw err
      }

      log.warn('Prompt too long, trimming to recent window and retrying once')

      // 非 LLM 裁剪重试：唯一的摘要调用是调用前的滚动压缩，这里只裁窗口、不再生成摘要。
      trimmedMessages = trimToRecentWindow(
        preprocessedMessages,
        AGENT_LIMITS.contextCompactRecentMessages,
      )
      didTrim = true

      const trimmedWithSystem = [new SystemMessage(systemPrompt), ...trimmedMessages]

      response = (await this.modelWithTools.invoke(trimmedWithSystem)) as AIMessage
      response.content = sanitizeAIMessageContent(response.content) as AIMessageContent
    }

    const content = extractTextContent(response.content)
    const toolCalls = response.tool_calls ?? []

    const subgraphCalls = detectSubgraphCall(toolCalls)

    // info: decision summary only; full content/args go to debug (file).
    log.info(
      'model 输出: 内容 %d 字符, tool_calls=[%s], routed=%s',
      content.length,
      toolCalls.map((tc) => tc.name).join(', '),
      subgraphCalls.map((call) => call.subgraph).join('+') || 'none',
    )
    log.debug('model 输出全量:', {
      rawContent: summarizeMessageContent(response.content),
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      })),
      routedSubgraphs: subgraphCalls.map((call) => call.subgraph),
    })

    let resultMessages: BaseMessage[]
    if (didTrim) {
      resultMessages = [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...trimmedMessages,
        response,
      ]
    } else {
      resultMessages = [response]
    }

    if (subgraphCalls.length === 0) {
      // No subgraph this round: clear the supervisor's own routing key (see
      // route()). Only a direct answer carries the turn text as `response`; a
      // plain tool round must not overwrite the turn text with its preamble.
      const isDirectAnswer = toolCalls.length === 0
      return isDirectAnswer
        ? { messages: resultMessages, pendingSubgraphs: [], response: content }
        : { messages: resultMessages, pendingSubgraphs: [] }
    }

    // The call info (call id + tool name) rides on the subgraph's own channels:
    // one set per subgraph, so neither can overwrite the other. A subgraph
    // declared more than once keeps its first call — one node run, one call
    // slot; the extras are answered by message preparation's backfill instead
    // of leaving a dangling tool_call_id. Running the same subgraph twice in one
    // super-step is not supported anyway: its progress/trace bookkeeping is
    // keyed per stream, not per run.
    const callInfo: Partial<MainGraphStateType> = {}
    const pendingSubgraphs: SubgraphName[] = []
    for (const call of subgraphCalls) {
      if (pendingSubgraphs.includes(call.subgraph)) continue
      pendingSubgraphs.push(call.subgraph)
      if (call.subgraph === 'palace') {
        callInfo.palaceToolCallId = call.toolCallId
        callInfo.palaceToolName = call.toolName
      } else {
        callInfo.mindmapToolCallId = call.toolCallId
        callInfo.mindmapToolName = call.toolName
      }
    }

    const routeState = {
      messages: [createToolCallMessage(response, content)],
      pendingSubgraphs,
      ...callInfo,
      response: content,
    }
    if (didTrim) {
      return { ...routeState, messages: resultMessages }
    }
    return routeState
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
