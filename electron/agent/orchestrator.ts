import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { END, START, StateGraph, getWriter } from '@langchain/langgraph'
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { type LLMProvider, ProviderCapability } from './providers/index.js'
import type { AgentServices } from './service.js'
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
import { createMindmapActionTools, type MindmapWriteProxy } from './tools/mindmapActions.js'
import { createReadFileTool } from './tools/readFile.js'
import { createReadMindmapTool, type MindmapReadQuery } from './tools/mindmapRead.js'
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
import { checkpointMessagesToSessionMessages } from './memory/checkpointer.js'
import type { MessagePipelineConfig } from './context/pipeline.js'
import type { StreamRuntime } from './streamManager.js'
import { splitCurrentTurn } from '../ipc.js'
import {
  runContextCompact,
  type RunContextAssemblyDeps,
  type RunContextCompactConfig,
} from './context/runContextCompact.js'

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
  /** 按需读导图快照提供者：主进程装配时注入（经反向 IPC 向渲染层拉取）。 */
  mindmapReadProvider?: (fileUuid: string, query: MindmapReadQuery) => Promise<string>
  /** 写工具渲染层代理：转发参数、返回渲染层落盘应答（原样）。 */
  mindmapWriteProxy?: MindmapWriteProxy
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
  private mcpTools: StructuredToolInterface[] = []
  private hasPalace: boolean

  constructor(
    private provider: LLMProvider,
    private services: AgentServices,
    private options: AgentOrchestratorOptions = {},
  ) {
    const caps = this.provider.capabilities
    this.hasPalace = caps.has(ProviderCapability.ImageGen) && caps.has(ProviderCapability.Vision)
    this.rebuildToolRegistry()
  }

  updateProvider(provider: LLMProvider, messagePipeline?: MessagePipelineConfig): void {
    this.provider = provider
    this.options = { ...this.options, messagePipeline }
    this.hasPalace =
      provider.capabilities.has(ProviderCapability.ImageGen) &&
      provider.capabilities.has(ProviderCapability.Vision)
    this.compiledMindmapSubgraph = null
    this.compiledPalaceSubgraph = null
    this.rebuildToolRegistry()
  }

  /**
   * Hot-swap MCP tools: rebuild the registry (default tools + MCP tools) and
   * invalidate the cached main graph. In-flight chats are unaffected because
   * Runners hold a registry snapshot taken at stream start.
   */
  setMcpTools(tools: StructuredToolInterface[]): void {
    this.mcpTools = [...tools]
    this.rebuildToolRegistry()
  }

  private rebuildToolRegistry(): void {
    this.toolRegistry = new ToolRegistry()
    this.registerDefaultTools({ hasPalace: this.hasPalace })
    for (const tool of this.mcpTools) {
      this.toolRegistry.registerTool(tool)
    }
  }

  /**
   * Register MindLane's default tools into the toolRegistry.
   * XML 写工具（固定 4 个）先注册，随后是路由工具。
   */
  private registerDefaultTools(options: { hasPalace: boolean }): void {
    // 写工具渲染层代理：参数转发给渲染层落盘应答器；未装配代理时调用即报错
    const writeProxy: MindmapWriteProxy = (fileUuid, action, args) => {
      const proxy = this.options.mindmapWriteProxy
      if (!proxy) {
        return Promise.reject(new Error('落盘通道不可用，无法执行写操作'))
      }
      return proxy(fileUuid, action, args)
    }
    const actionTools = createMindmapActionTools(writeProxy)

    this.toolRegistry.registerTool(actionTools.insertXmlFragmentTool)
    this.toolRegistry.registerTool(actionTools.updateNodeTool)
    this.toolRegistry.registerTool(actionTools.moveNodeTool)
    this.toolRegistry.registerTool(actionTools.deleteNodeTool)

    // Read-only workspace file access for the mindlane chat agent.
    this.toolRegistry.registerTool(
      createReadFileTool(() => this.services.sessionManager.workspacePath),
    )

    // 按需读导图：模型需要整图结构（超出选中范围）时实时拉取。
    const mindmapReadProvider = this.options.mindmapReadProvider
    if (mindmapReadProvider) {
      this.toolRegistry.registerTool(createReadMindmapTool(mindmapReadProvider))
    }

    for (const tool of getToolSchemas()) {
      if (tool.name === GENERATE_PALACE_TOOL && !options.hasPalace) {
        continue
      }
      this.toolRegistry.registerTool(tool)
    }

    logger.withContext('orchestrator').info(
      'registered %d tools (%d executable), hasPalace=%s, names=%o',
      this.toolRegistry.allTools.length,
      this.toolRegistry.executableTools.length,
      options.hasPalace,
      this.toolRegistry.allTools.map((t) => t.name),
    )
  }

  getStreamRuntime(): StreamRuntime {
    const toolRegistry = this.toolRegistry.snapshot()
    const graph = this.buildGraph(toolRegistry)
    const checkpointer = this.services.checkpointer.getAdapter()
    // LangGraph 的泛型 stream<TStreamMode> 返回类型无法与 StreamGraph 的
    // 只读元组签名完全结构匹配（实测 TS2322），故在此局部强转并注释原因，
    // 避免调用侧继续以 as unknown as 向编译器撒谎。
    return {
      graph: graph.compile(
        checkpointer ? { checkpointer } : undefined,
      ) as unknown as StreamRuntime['graph'],
      toolRegistry,
      buildResponse: this.buildResponse.bind(this),
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
        invoke: (
          state: MainGraphStateType,
          config: {
            recursionLimit: number
            callbacks: []
            configurable?: { writer?: unknown }
          },
        ) => Promise<T>
      },
      state: MainGraphStateType,
    ): Promise<Partial<MainGraphStateType>> => {
      // langgraph 的 pickRunnableConfigKeys 不透传 custom writer：把外层 getWriter()
      // 显式经 configurable.writer 传入子图，子图节点内的 getWriter() 才能继续发进度事件。
      const writer = getWriter()
      const result = await subgraph.invoke(state, {
        recursionLimit: AGENT_LIMITS.recursionLimit,
        callbacks: [],
        ...(writer ? { configurable: { writer } } : {}),
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
      const log = logger.withContext('tools')
      try {
        const lastMessage = state.messages[state.messages.length - 1]
        log.debug(
          'last message type: %s, tool_calls: %o',
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
          log.debug('invoking toolNode with %d calls', actionToolCalls.length)
          const result = await toolNode.invoke(filteredState)
          const messages = result.messages ?? result
          const normalized = await normalizeToolMessages(
            Array.isArray(messages) ? messages : [messages],
          )
          log.debug(
            'normalized messages: %o',
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
        log.error('error:', err)
        throw err
      }
    }

    const subgraphResultNode = async (state: MainGraphStateType) => packageResult(state)

    const supervisor = new MindLaneAgent(
      this.provider,
      toolRegistry,
      { hasPalace: this.hasPalace },
      this.services.memoryManager,
      {
        userDataPath: this.options.userDataPath,
        messagePipeline: this.options.messagePipeline,
      },
    )

    // Proactive compaction: compress to persistence (rolling summary), then read
    // unarchived messages by budget. The running summary flows to the supervisor
    // via state.summary (injected as `## 历史摘要`). Assembly lives in
    // runContextCompact; this node is a one-line delegator so the call graph
    // attributes Consolidator's caller to a named module symbol.
    const runAssemblyDeps: RunContextAssemblyDeps = {
      provider: this.provider,
      services: this.services,
      hasPalace: this.hasPalace,
      userDataPath: this.options.userDataPath,
      toolRegistry,
    }
    const contextCompactNode = (state: MainGraphStateType, config?: RunContextCompactConfig) =>
      runContextCompact(runAssemblyDeps, state, config)

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
    const assistantMessages = checkpointMessagesToSessionMessages(
      splitCurrentTurn(result.messages).current,
    ).filter((msg): msg is AssistantMessage => msg.role === 'assistant')
    const messages = assistantMessages.length > 0 ? assistantMessages : undefined

    const response: ChatResponse = {
      content: rawContent,
      messages,
      toolCalls: this.extractToolCalls(result.messages),
    }

    // Mindmap data flows through XML fragment → insertXmlFragment tool calls
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

  private extractToolCalls(messages: BaseMessage[]): ChatResponse['toolCalls'] {
    const toolCalls: ChatResponse['toolCalls'] = []
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.type === 'human') break
      if (msg.type === 'tool') {
        const toolMsg = msg as BaseMessage & {
          name?: string
          content: unknown
          additional_kwargs?: Record<string, unknown>
        }
        const toolSteps = toolMsg.additional_kwargs?.toolSteps
        toolCalls.unshift({
          name: toolMsg.name ?? 'unknown',
          args: {},
          result:
            typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content),
          steps: Array.isArray(toolSteps) ? toolSteps : undefined,
        })
      }
    }
    return toolCalls.length > 0 ? toolCalls : undefined
  }
}
