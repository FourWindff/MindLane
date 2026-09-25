import { ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { END, START, StateGraph } from '@langchain/langgraph'
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { LLMProvider } from './providers/index.js'
import type { AgentServices } from './service.js'
import type {
  MainGraphStateType,
  PalaceSubgraphStateType,
  MindmapSubgraphStateType,
} from './state.js'
import { MainGraphState } from './state.js'

import { MindLaneAgent } from './agenthub/mindlane/mindlaneAgent.js'
import type { MindLaneNode, MindLaneEdge, ChatToolCall } from '../../src/shared/lib/fileFormat.js'
import { buildPalacePayload, buildPalaceSubgraph } from './graphs/palaceGraph.js'
import { buildMindmapSubgraph } from './graphs/mindmapGraph/index.js'
import { createMindmapActionTools, type MindmapWriteProxy } from './tools/mindmapActions.js'
import { createReadFileTool } from './tools/readFile.js'
import { createReadMindmapTool, type MindmapReadQuery } from './tools/mindmapRead.js'
import { ToolRegistry } from './tools/registry.js'
import { _normalize_tool_result } from './tools/toolResultNormalizer.js'
import { deriveToolStatus } from './toolStatus.js'
import { logger } from '../shared/logger.js'
import { getToolSchemas } from './subgraphRouter.js'
import { checkpointMessagesToSessionMessages } from './memory/checkpointer.js'
import type { MessagePreparationConfig } from './context/messagePreparation.js'
import type { StreamRuntime } from './streamManager.js'
import { splitCurrentTurn, type PalaceArtworkStyle, type PalaceRunPayload } from '../ipc.js'
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
  palaceData?: PalaceRunPayload
}

interface AgentOrchestratorOptions {
  userDataPath?: string
  messagePipeline?: MessagePreparationConfig
  /** 按需读导图快照提供者：主进程装配时注入（经反向 IPC 向渲染层拉取）。 */
  mindmapReadProvider?: (fileUuid: string, query: MindmapReadQuery) => Promise<string>
  /** 写工具渲染层代理：转发参数、返回渲染层落盘应答（原样）。 */
  mindmapWriteProxy?: MindmapWriteProxy
}

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

  constructor(
    private provider: LLMProvider,
    private services: AgentServices,
    private options: AgentOrchestratorOptions = {},
  ) {
    this.rebuildToolRegistry()
  }

  updateProvider(provider: LLMProvider, messagePipeline?: MessagePreparationConfig): void {
    this.provider = provider
    this.options = { ...this.options, messagePipeline }
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
    this.registerDefaultTools()
    for (const tool of this.mcpTools) {
      this.toolRegistry.registerTool(tool)
    }
  }

  /**
   * Register MindLane's default tools into the toolRegistry.
   * XML 写工具（固定 4 个）先注册，随后是路由工具。
   */
  private registerDefaultTools(): void {
    const actionTools = createMindmapActionTools(this.getWriteProxy())

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
      this.toolRegistry.registerTool(tool)
    }

    logger.withContext('orchestrator').info(
      'registered %d tools (%d executable), names=%o',
      this.toolRegistry.allTools.length,
      this.toolRegistry.executableTools.length,
      this.toolRegistry.allTools.map((t) => t.name),
    )
  }

  getStreamRuntime(artworkStyle: PalaceArtworkStyle = 'vector'): StreamRuntime {
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
      artworkStyle,
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
        // The palace subgraph lands its own payload through the same write
        // responder the model's write tools use (CONTEXT.md「确定性落图」).
        writeProxy: this.getWriteProxy(),
      }).compile()
    }
    return this.compiledPalaceSubgraph
  }

  /** 写工具渲染层代理：参数转发给渲染层落盘应答器；未装配代理时调用即报错。 */
  private getWriteProxy(): MindmapWriteProxy {
    return (fileUuid, action, args) => {
      const proxy = this.options.mindmapWriteProxy
      if (!proxy) {
        return Promise.reject(new Error('落盘通道不可用，无法执行写操作'))
      }
      return proxy(fileUuid, action, args)
    }
  }

  buildGraph(toolRegistry = this.toolRegistry) {
    const toolNode = new ToolNode(toolRegistry.executableTools)

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

    /**
     * Tool execution node: one dispatch per plain tool call (the router sends each
     * call as its own `Send`, so ToolNode executes exactly that call and never
     * sees the virtual subgraph calls — no filtering of the supervisor message
     * happens here).
     */
    const toolsNode = async (
      state: MainGraphStateType & { lg_tool_call?: unknown },
    ): Promise<{ messages: BaseMessage[] }> => {
      const log = logger.withContext('tools')
      try {
        const call = state.lg_tool_call as { id?: string; name?: string } | undefined
        log.debug('executing tool call: %o', call)
        const result = await toolNode.invoke(state)
        const messages = (result as { messages?: BaseMessage[] }).messages ?? result
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
      } catch (err) {
        log.error('error:', err)
        throw err
      }
    }

    const supervisor = new MindLaneAgent(this.provider, toolRegistry, this.services.memoryManager, {
      userDataPath: this.options.userDataPath,
      messagePipeline: this.options.messagePipeline,
    })

    // Proactive compaction: compress to persistence (rolling summary), then read
    // unarchived messages by budget. The running summary flows to the supervisor
    // via state.summary (injected as `## 历史摘要`). Assembly lives in
    // runContextCompact; this node is a one-line delegator so the call graph
    // attributes Consolidator's caller to a named module symbol.
    const runAssemblyDeps: RunContextAssemblyDeps = {
      provider: this.provider,
      services: this.services,
      userDataPath: this.options.userDataPath,
      toolRegistry,
    }
    const contextCompactNode = (state: MainGraphStateType, config?: RunContextCompactConfig) =>
      runContextCompact(runAssemblyDeps, state, config)

    // Routing function: MindLaneAgent.route() owns dispatch. It returns several
    // destinations at once (one `Send` per plain tool call, one node per pending
    // subgraph), which is what puts them in the same super-step.
    const routeFn = (state: MainGraphStateType) => supervisor.route(state)

    // Unified graph structure: both subgraphs are mounted as nodes of this graph.
    // Mounting (rather than a node function nesting .invoke()) is what makes the
    // subgraph share the main run: one checkpointer, one recursion budget, the
    // same stream/writer, and the subgraph's own close-out node writes its
    // ToolMessage straight into the messages channel. The model-visible interface
    // stays the two virtual tool schemas the supervisor routes on.
    //
    // Entry: a plain chat run compacts and then asks the supervisor; the manual
    // palace run (runEntry='palace') goes straight to the palace subgraph and
    // ends there — no compaction, no model round.
    const entryTarget = (state: MainGraphStateType) =>
      state.runEntry === 'palace' ? 'palaceSubgraph' : 'contextCompact'
    const exitTarget = (state: MainGraphStateType) =>
      state.runEntry === 'palace' ? '__end__' : 'supervisor'
    const graph = new StateGraph(MainGraphState)
      .addNode('contextCompact', contextCompactNode)
      .addNode('supervisor', (state) => supervisor.invoke(state))
      .addNode('tools', toolsNode)
      .addNode('mindmapSubgraph', this.getCompiledMindmapSubgraph())
      .addNode('palaceSubgraph', this.getCompiledPalaceSubgraph())
      .addConditionalEdges(START, entryTarget, {
        contextCompact: 'contextCompact',
        palaceSubgraph: 'palaceSubgraph',
      })
      .addEdge('contextCompact', 'supervisor')
      .addConditionalEdges('supervisor', routeFn, {
        tools: 'tools',
        mindmapSubgraph: 'mindmapSubgraph',
        palaceSubgraph: 'palaceSubgraph',
        __end__: END,
      })
      .addEdge('mindmapSubgraph', 'supervisor')
      .addConditionalEdges('palaceSubgraph', exitTarget, {
        supervisor: 'supervisor',
        __end__: END,
      })
      .addEdge('tools', 'supervisor')

    return graph
  }

  /**
   * Build the response object.
   */
  buildResponse(result: MainGraphStateType, streamingContent?: string): ChatResponse {
    // The palace entry has no supervisor reply to fall back to: its run carries
    // the palace payload, not prose.
    const fallback = result.runEntry === 'palace' ? '' : '抱歉，我无法生成回复。'
    const rawContent = streamingContent || result.response || fallback
    const assistantMessages = checkpointMessagesToSessionMessages(
      splitCurrentTurn(result.messages).current,
    ).filter((msg): msg is AssistantMessage => msg.role === 'assistant')
    const messages = assistantMessages.length > 0 ? assistantMessages : undefined

    const response: ChatResponse = {
      content: rawContent,
      messages,
      // A palace entry run has no chat record to keep: its reply is the landing
      // payload below, not a tool-call log.
      toolCalls: result.runEntry === 'palace' ? undefined : this.extractToolCalls(result.messages),
    }

    // Mindmap data flows through XML fragment → insertXmlFragment tool calls
    // The insertion is handled by the tool execution in the supervisor loop

    // Palace data: the landing payload the renderer applies with code (manual run)
    // — the same shape the subgraph wrote into its close-out ToolMessage. Chat
    // runs keep their old surface (a successful palace only).
    if (result.runEntry === 'palace' || result.memoryRoute.length > 0) {
      response.palaceData = buildPalacePayload(result)
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
        const result =
          typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)
        toolCalls.unshift({
          name: toolMsg.name ?? 'unknown',
          args: {},
          result,
          status: deriveToolStatus(result),
          steps: Array.isArray(toolSteps) ? toolSteps : undefined,
        })
      }
    }
    return toolCalls.length > 0 ? toolCalls : undefined
  }
}
