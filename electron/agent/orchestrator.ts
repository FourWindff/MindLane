import {
  AIMessage,
  ToolMessage,
  SystemMessage,
  type BaseMessage,
  RemoveMessage,
} from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { END, START, StateGraph, REMOVE_ALL_MESSAGES } from '@langchain/langgraph'
import type { CompiledStateGraph } from '@langchain/langgraph'
import { type LLMProvider, ProviderCapability } from './providers/index.js'
import type { AiService } from './service.js'
import type {
  SelectedNodeContent,
  MemoryPalaceStation,
  MainGraphStateType,
  PalaceSubgraphStateType,
  MindmapSubgraphStateType,
} from './state.js'
import { MainGraphState } from './state.js'

import { MindLaneAgent } from './agenthub/mindlane/mindlaneAgent.js'
import type { MindLaneNode, MindLaneEdge, ChatToolCall } from '../../src/shared/lib/fileFormat.js'
import { buildPalaceSubgraph } from './graphs/palaceGraph.js'
import { buildMindmapSubgraph } from './graphs/mindmapGraph/index.js'
import { createMindmapActionTools } from './tools/mindmapActions.js'
import { ToolRegistry } from './tools/registry.js'
import { _normalize_tool_result } from './tools/toolResultNormalizer.js'
import { logger } from '../shared/logger.js'
import {
  GENERATE_PALACE_TOOL,
  getToolSchemas,
  isSubgraphCall,
  packageResult,
} from './subgraphRouter.js'
import { AGENT_LIMITS } from './config.js'
import { compactContext } from './memory/contextCompact.js'
import { checkpointMessagesToSessionMessages } from './memory/checkpointer.js'
import type { MessagePipelineConfig } from './context/pipeline.js'
import { ContextBuilder } from './agenthub/mindlane/context.js'
import { Consolidator } from './context/consolidator.js'

interface AssistantMessage {
  role: 'assistant'
  content: string
  toolCalls?: ChatToolCall[]
}

interface ChatResponse {
  content: string
  messages?: AssistantMessage[]
  toolCalls?: ChatToolCall[]
  mindmapData?: {
    nodes: MindLaneNode[]
    edges: MindLaneEdge[]
    title: string
  }
  palaceData?: {
    content: string
    imageUrls?: string[]
    memoryRoute?: MemoryPalaceStation[]
  }
}

interface AgentOrchestratorOptions {
  userDataPath?: string
  messagePipeline?: MessagePipelineConfig
}

interface PalaceFromNodesResult {
  ok: true
  label: string
  stations: Array<{
    order: number
    content: string
    anchorVisual: string
    association?: string
    x: number
    y: number
    linkedNodeId: string
  }>
  imageUrl: string
  sourceNodeIds: string[]
}

interface PalaceFromNodesError {
  ok: false
  error: string
}

type NodesToPalaceResult = PalaceFromNodesResult | PalaceFromNodesError

export class AgentOrchestrator {
  private compiledMainGraph: CompiledStateGraph<MainGraphStateType, unknown, string> | null = null
  private compiledMindmapSubgraph: CompiledStateGraph<
    MindmapSubgraphStateType,
    unknown,
    string
  > | null = null
  private compiledPalaceSubgraph: CompiledStateGraph<
    PalaceSubgraphStateType,
    unknown,
    string
  > | null = null
  private toolRegistry = new ToolRegistry()
  private hasPalace: boolean

  constructor(
    private provider: LLMProvider,
    private aiService: AiService,
    private options: AgentOrchestratorOptions = {},
  ) {
    const caps = this.provider.capabilities
    this.hasPalace = caps.has(ProviderCapability.ImageGen) && caps.has(ProviderCapability.Vision)
    this.registerDefaultTools({ hasPalace: this.hasPalace })
  }

  updateProvider(provider: LLMProvider, messagePipeline?: MessagePipelineConfig): void {
    this.provider = provider
    this.options = { ...this.options, messagePipeline }
    this.hasPalace =
      provider.capabilities.has(ProviderCapability.ImageGen) &&
      provider.capabilities.has(ProviderCapability.Vision)
    this.compiledMainGraph = null
    this.compiledMindmapSubgraph = null
    this.compiledPalaceSubgraph = null
    this.toolRegistry = new ToolRegistry()
    this.registerDefaultTools({ hasPalace: this.hasPalace })
  }

  /**
   * Register MindLane's default tools into the toolRegistry.
   * Action tools are registered first, followed by routing tools.
   */
  private registerDefaultTools(options: { hasPalace: boolean }): void {
    const actionTools = createMindmapActionTools(options.hasPalace)

    this.toolRegistry.registerTool(actionTools.addTextNodeTool)
    this.toolRegistry.registerTool(actionTools.updateNodeTool)
    this.toolRegistry.registerTool(actionTools.deleteNodeTool)
    this.toolRegistry.registerTool(actionTools.batchAddNodesTool)

    if (actionTools.addPalaceNodeTool) {
      this.toolRegistry.registerTool(actionTools.addPalaceNodeTool)
    }

    for (const tool of getToolSchemas()) {
      if (tool.name === GENERATE_PALACE_TOOL && !options.hasPalace) {
        continue
      }
      this.toolRegistry.registerTool(tool)
    }

    logger.info(
      '[registerDefaultTools] registered %d tools (%d executable), hasPalace=%s, names=%o',
      this.toolRegistry.allTools.length,
      this.toolRegistry.executableTools.length,
      options.hasPalace,
      this.toolRegistry.allTools.map((t) => t.name),
    )
  }

  getCompiledMainGraph() {
    if (!this.compiledMainGraph) {
      const graph = this.buildGraph()
      const checkpointer = this.aiService.checkpointer.getAdapter()
      this.compiledMainGraph = graph.compile(checkpointer ? { checkpointer } : undefined)
    }
    return this.compiledMainGraph
  }

  getStreamRuntime() {
    const toolRegistry = this.toolRegistry.snapshot()
    const graph = this.buildGraph(toolRegistry)
    const checkpointer = this.aiService.checkpointer.getAdapter()
    return {
      graph: graph.compile(checkpointer ? { checkpointer } : undefined),
      toolRegistry,
      buildResponse: this.buildResponse.bind(this),
      provider: this.provider,
    }
  }

  private getCompiledMindmapSubgraph() {
    if (!this.compiledMindmapSubgraph) {
      this.compiledMindmapSubgraph = buildMindmapSubgraph({
        provider: this.provider,
        userDataPath: this.options.userDataPath,
      }).compile()
    }
    return this.compiledMindmapSubgraph
  }

  private getCompiledPalaceSubgraph() {
    if (!this.compiledPalaceSubgraph) {
      this.compiledPalaceSubgraph = buildPalaceSubgraph({
        provider: this.provider,
      }).compile()
    }
    return this.compiledPalaceSubgraph
  }

  async runPalaceFromNodes(
    selectedNodes: SelectedNodeContent[],
    provider = this.provider,
  ): Promise<NodesToPalaceResult> {
    if (selectedNodes.length === 0) {
      return { ok: false, error: '未选中任何节点' }
    }

    const caps = provider.capabilities
    if (!caps.has(ProviderCapability.ImageGen) || !caps.has(ProviderCapability.Vision)) {
      return {
        ok: false,
        error: '当前 provider 不支持记忆宫殿功能（需要文生图和视觉理解能力）',
      }
    }

    // Use the dedicated Palace Subgraph.
    const app =
      provider === this.provider
        ? this.getCompiledPalaceSubgraph()
        : buildPalaceSubgraph({ provider }).compile()

    try {
      const result = (await app.invoke(
        {
          messages: [],
          context: null,
          error: '',
          palaceInputText: '',
          palaceInputNodes: selectedNodes,
          memoryItems: [],
          palace: null,
          imagePrompt: '',
          imageUrls: [],
          detectedCoords: [],
          memoryRoute: [],
        },
        { recursionLimit: AGENT_LIMITS.recursionLimit },
      )) as PalaceSubgraphStateType

      if (result.error) {
        return { ok: false, error: result.error }
      }

      const imageUrl = result.imageUrls[0] ?? ''

      return {
        ok: true,
        label: result.palace?.theme || `记忆宫殿 (${selectedNodes.length} 站)`,
        stations: result.memoryRoute.map((s: MemoryPalaceStation) => ({
          order: s.order,
          content: s.content,
          anchorVisual: s.anchorVisual ?? '',
          association: s.association,
          x: s.x,
          y: s.y,
          linkedNodeId: s.linkedNodeId ?? '',
        })),
        imageUrl,
        sourceNodeIds: selectedNodes.map((n) => n.id),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  buildGraph(toolRegistry = this.toolRegistry) {
    const toolNode = new ToolNode(toolRegistry.executableTools)
    const invokeSubgraph = async <T extends { messages?: BaseMessage[] }>(
      subgraph: {
        invoke: (state: MainGraphStateType, config: { recursionLimit: number }) => Promise<T>
      },
      state: MainGraphStateType,
    ): Promise<Partial<MainGraphStateType>> => {
      const result = await subgraph.invoke(state, {
        recursionLimit: AGENT_LIMITS.recursionLimit,
      })
      const updates = { ...(result as MainGraphStateType & T) }
      delete (updates as Record<string, unknown>).messages
      return updates as Partial<MainGraphStateType>
    }

    const mindmapSubgraphNode = async (state: MainGraphStateType) =>
      invokeSubgraph(this.getCompiledMindmapSubgraph(), state)

    const palaceSubgraphNode = async (state: MainGraphStateType) =>
      invokeSubgraph(this.getCompiledPalaceSubgraph(), state)

    // Tool execution node: filter out virtual subgraph routing tools (already handled in supervisor.invoke).
    const normalizeToolMessages = async (messages: BaseMessage[]): Promise<BaseMessage[]> => {
      return Promise.all(
        messages.map(async (msg) => {
          if (msg.type !== 'tool') return msg
          const toolMsg = msg as ToolMessage
          const normalized = await _normalize_tool_result(
            toolMsg.name ?? 'unknown',
            toolMsg.content,
            toolMsg.tool_call_id,
            this.options.userDataPath,
          )
          return new ToolMessage({
            tool_call_id: toolMsg.tool_call_id,
            name: toolMsg.name,
            content: normalized,
            additional_kwargs: toolMsg.additional_kwargs,
          })
        }),
      )
    }

    const toolsNode = async (state: MainGraphStateType) => {
      try {
        const lastMessage = state.messages[state.messages.length - 1]
        logger.info(
          '[toolsNode] last message type: %s, tool_calls: %o',
          lastMessage?.getType(),
          (lastMessage as AIMessage)?.tool_calls?.map((tc) => ({ id: tc.id, name: tc.name })),
        )
        if (lastMessage && lastMessage.type === 'ai') {
          const msg = lastMessage as AIMessage
          const actionToolCalls = msg.tool_calls?.filter((tc) => !isSubgraphCall(tc.name)) ?? []
          if (actionToolCalls.length === 0) {
            return { messages: [] }
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
          }
          logger.info('[toolsNode] invoking toolNode with %d calls', actionToolCalls.length)
          const result = await toolNode.invoke(filteredState)
          const messages = result.messages ?? result
          logger.info(
            '[toolsNode] toolNode returned %d messages',
            Array.isArray(messages) ? messages.length : 1,
          )
          const normalized = await normalizeToolMessages(
            Array.isArray(messages) ? messages : [messages],
          )
          logger.info(
            '[toolsNode] normalized messages: %o',
            normalized.map((m) => ({
              type: m.getType(),
              content:
                typeof m.content === 'string'
                  ? m.content.slice(0, 200)
                  : JSON.stringify(m.content).slice(0, 200),
            })),
          )
          return { messages: normalized }
        }
        const result = await toolNode.invoke(state)
        const messages = result.messages ?? result
        return {
          messages: await normalizeToolMessages(Array.isArray(messages) ? messages : [messages]),
        }
      } catch (err) {
        logger.error('[toolsNode] error:', err)
        throw err
      }
    }

    const subgraphResultNode = async (state: MainGraphStateType) => packageResult(state)

    const supervisor = new MindLaneAgent(
      this.provider,
      toolRegistry,
      { hasEmbeddings: false, hasPalace: this.hasPalace },
      this.aiService.memoryManager,
      {
        userDataPath: this.options.userDataPath,
        messagePipeline: this.options.messagePipeline,
      },
    )

    // Proactive compaction node: archive to persistence first, then read unarchived messages by budget, finally fall back in memory.
    const contextCompactNode = async (
      state: MainGraphStateType,
      config?: { configurable?: Record<string, unknown> },
    ) => {
      const sessionManager = this.aiService.sessionManager
      const threadId = config?.configurable?.thread_id as string | undefined

      if (!sessionManager?.isReady() || !threadId) {
        return compactContext(
          state,
          toolRegistry.allTools,
          this.provider,
          this.aiService.memoryManager,
          {
            hasEmbeddings: false,
            hasPalace: this.hasPalace,
          },
        )
      }

      const buildMessages = async (
        messages: BaseMessage[],
        lastSummary?: string,
      ): Promise<BaseMessage[]> => {
        const builder = new ContextBuilder()
          .withMessages(messages)
          .withContext(state.context ?? undefined)
          .withCapabilityFlags({ hasEmbeddings: false, hasPalace: this.hasPalace })
          .withMemory(this.aiService.memoryManager)
          .withLastSummary(lastSummary)

        await builder.buildMemoryContext()
        builder.buildSystemPrompt().buildEnvironmentPrompt().buildMindmapContext().buildHistory()

        return [new SystemMessage(builder.build()), ...messages]
      }

      const getToolDefinitions = () => toolRegistry.allTools

      const consolidator = new Consolidator(
        {
          sessionManager,
          provider: this.provider,
          buildMessages,
          getToolDefinitions,
        },
        {
          safetyBuffer: AGENT_LIMITS.consolidationSafetyBuffer,
          consolidationRatio: AGENT_LIMITS.consolidationRatio,
          maxContextMessages: AGENT_LIMITS.maxContextMessages,
          maxMessagesBeforeTokenCheck: AGENT_LIMITS.maxMessagesBeforeTokenCheck,
          maxConsolidationRounds: AGENT_LIMITS.maxConsolidationRounds,
        },
      )

      try {
        await consolidator.maybe_consolidate_by_tokens(threadId)
        const contextMessages = await consolidator.getMessagesForContext(threadId, {
          maxMessages: AGENT_LIMITS.maxContextMessages,
          budget:
            AGENT_LIMITS.contextWindowTokens -
            AGENT_LIMITS.maxCompletionTokens -
            AGENT_LIMITS.consolidationSafetyBuffer,
        })

        return {
          messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...contextMessages],
        }
      } catch (err) {
        logger.warn(
          '[contextCompact] Consolidator failed for session %s, falling back to compactContext:',
          threadId,
          err,
        )
        return compactContext(
          state,
          toolRegistry.allTools,
          this.provider,
          this.aiService.memoryManager,
          {
            hasEmbeddings: false,
            hasPalace: this.hasPalace,
          },
        )
      }
    }

    // Unified routing function: MindLaneAgent.route() already handles fallback when palace is unavailable.
    const routeFn = (state: MainGraphStateType) => supervisor.route(state)

    // Unified graph structure: always includes the palaceSubgraph node.
    // When hasPalace=false the subgraph is still compiled but is never executed (route() guarantees this).
    const graph = new StateGraph(MainGraphState)
      .addNode('contextCompact', contextCompactNode)
      .addNode('supervisor', (state) => supervisor.invoke(state))
      .addNode('tools', toolsNode)
      .addNode('mindmapSubgraph', mindmapSubgraphNode)
      .addNode('palaceSubgraph', palaceSubgraphNode)
      .addNode('subgraphResult', subgraphResultNode)
      .addEdge(START, 'contextCompact')
      .addEdge('contextCompact', 'supervisor')
      .addConditionalEdges('supervisor', routeFn, {
        tools: 'tools',
        mindmapSubgraph: 'mindmapSubgraph',
        palaceSubgraph: 'palaceSubgraph',
        __end__: END,
      })
      .addEdge('mindmapSubgraph', 'subgraphResult')
      .addEdge('palaceSubgraph', 'subgraphResult')
      .addEdge('subgraphResult', 'supervisor')
      .addEdge('tools', 'supervisor')

    return graph
  }

  /**
   * Build the response object.
   */
  buildResponse(result: MainGraphStateType, streamingContent?: string): ChatResponse {
    const rawContent = streamingContent || result.response || '抱歉，我无法生成回复。'
    const messages = this.extractCurrentTurnAssistantMessages(result.messages)

    const response: ChatResponse = {
      content: rawContent,
      messages,
      toolCalls: this.extractToolCalls(result.messages),
    }

    // Mindmap data now flows through YAML → batchAddMindmapNodes tool calls
    // The insertion is handled by the tool execution in the supervisor loop

    if (result.memoryRoute.length > 0) {
      response.palaceData = {
        content: rawContent,
        imageUrls: result.imageUrls,
        memoryRoute: result.memoryRoute,
      }
    }

    return response
  }

  private extractCurrentTurnAssistantMessages(messages: BaseMessage[]): ChatResponse['messages'] {
    const lastHumanIndex = messages.findLastIndex((m: BaseMessage) => m.type === 'human')
    const currentTurnMessages = lastHumanIndex >= 0 ? messages.slice(lastHumanIndex + 1) : messages
    const sessionMessages = checkpointMessagesToSessionMessages(currentTurnMessages)
    const assistantMessages = sessionMessages.filter(
      (msg): msg is AssistantMessage => msg.role === 'assistant',
    )
    return assistantMessages.length > 0 ? assistantMessages : undefined
  }

  private extractToolCalls(messages: BaseMessage[]): ChatResponse['toolCalls'] {
    const toolCalls: ChatResponse['toolCalls'] = []
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.type === 'human') break
      if (msg.type === 'tool') {
        const toolMsg = msg as BaseMessage & {
          name?: string
          content: unknown
        }
        toolCalls.unshift({
          name: toolMsg.name ?? 'unknown',
          args: {},
          result:
            typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content),
        })
      }
    }
    return toolCalls.length > 0 ? toolCalls : undefined
  }
}
