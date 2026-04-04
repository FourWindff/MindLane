import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { END, START, StateGraph, MemorySaver } from '@langchain/langgraph'
import type { LLMProvider } from './providers/index.js'
import { urlToDataUrl } from './providers/index.js'
import type { AiService } from './service.js'
import { compressMessages } from './memory/compression.js'
import { AgentStateWithHITL } from './state.js'
import type { SelectedNodeContent, MemoryPalaceStation, GeneratedNode, GeneratedEdge } from './state.js'
import { SupervisorAgent, stripIntentMarkers } from './agents/supervisor.js'
import { MindmapGenAgent } from './agents/mindmapGen.js'
import { createSearchTools } from './agents/tools/index.js'
import type { MindmapContextData } from './agents/tools/mindmapContext.js'
import type { MindLaneNode, MindLaneEdge } from '../../src/shared/lib/fileFormat.js'
import { buildPalaceSubgraph, HITLInterruptError, type HITLInterruptData } from './graphs/palaceGraph.js'

export type { MindmapContextData }

export interface ChatRequest {
  threadId: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  context?: MindmapContextData
}

export interface ChatResponse {
  content: string
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown>
    result: string
  }>
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

// HITL 数据类型
export interface HITLMindmapData {
  type: 'mindmapGen_confirmation'
  currentStructure: {
    nodes: GeneratedNode[]
    edges: GeneratedEdge[]
    title: string
  }
}

export type HITLData = HITLInterruptData | HITLMindmapData

/**
 * 扩展的流回调接口，支持 HITL
 */
export interface StreamCallbacks {
  onToken: (token: string) => void
  onToolStart: (name: string, input: Record<string, unknown>) => void
  onToolEnd: (name: string, output: string) => void
  onEnd: (response: ChatResponse) => void
  onError: (error: string) => void
  onHITL?: (data: HITLData) => void | Promise<void>
}

export interface PalaceFromNodesResult {
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

export interface PalaceFromNodesError {
  ok: false
  error: string
}

export type NodesToPalaceResult = PalaceFromNodesResult | PalaceFromNodesError

export interface MindmapFromDocResult {
  nodes: GeneratedNode[]
  edges: GeneratedEdge[]
  documentTitle: string
}

export class AgentOrchestrator {
  constructor(
    private provider: LLMProvider,
    private aiService: AiService,
  ) {}

  async run(request: ChatRequest): Promise<ChatResponse> {
    const compressed = await this.buildInputMessages(request)
    const graph = this.buildGraph(request.context, { enableHITL: false })
    const app = graph.compile()

    const result = await app.invoke(
      { messages: compressed, context: request.context ?? null },
      { recursionLimit: 80 },
    )

    return this.buildResponse(result as typeof AgentStateWithHITL.State)
  }

  async stream(
    request: ChatRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    options: { enableHITL?: boolean } = {},
  ): Promise<void> {
    const { enableHITL = false } = options
    const compressed = await this.buildInputMessages(request)
    const graph = this.buildGraph(request.context, { enableHITL })
    const checkpointer = new MemorySaver()
    const app = graph.compile({ checkpointer })
    const threadId = `stream-${Date.now()}`

    let fullContent = ''

    try {
      const streamConfig = {
        version: 'v2' as const,
        signal,
        recursionLimit: 80,
        configurable: { thread_id: threadId },
      }

      const stream = app.streamEvents(
        { messages: compressed, context: request.context ?? null },
        streamConfig,
      )

      for await (const event of stream) {
        if (signal?.aborted) break

        if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk
          if (chunk && typeof chunk.content === 'string' && chunk.content) {
            fullContent += chunk.content
            callbacks.onToken(chunk.content)
          }
        } else if (event.event === 'on_tool_start') {
          const toolName = event.name ?? 'unknown'
          const input = (event.data?.input ?? {}) as Record<string, unknown>
          callbacks.onToolStart(toolName, input)
        } else if (event.event === 'on_tool_end') {
          const toolName = event.name ?? 'unknown'
          const output = event.data?.output
          const outputStr = typeof output === 'string' ? output : JSON.stringify(output ?? '')
          callbacks.onToolEnd(toolName, outputStr)
        }
      }

      const snapshot = await app.getState({ configurable: { thread_id: threadId } })
      const result = snapshot.values as typeof AgentStateWithHITL.State

      callbacks.onEnd(this.buildResponse(result, fullContent))
    } catch (err) {
      // 处理 HITL 中断
      if (err instanceof HITLInterruptError && callbacks.onHITL) {
        await callbacks.onHITL(err.data)
        // HITL 中断不调用 onError，等待用户 resume
        return
      }

      if (signal?.aborted) {
        callbacks.onEnd({ content: stripIntentMarkers(fullContent) || '（已停止生成）' })
        return
      }
      callbacks.onError(err instanceof Error ? err.message : String(err))
    }
  }

  async runPalaceFromNodes(selectedNodes: SelectedNodeContent[]): Promise<NodesToPalaceResult> {
    if (selectedNodes.length === 0) {
      return { ok: false, error: '未选中任何节点' }
    }

    // 使用独立的 Palace Subgraph
    const palaceSubgraph = buildPalaceSubgraph({
      provider: this.provider,
      enableHITL: false,
    })
    const app = palaceSubgraph.compile()

    try {
      const result = await app.invoke(
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
          interruptPoint: null,
          userConfirmedPrompt: null,
          userConfirmedStructure: null,
        },
        { recursionLimit: 80 },
      )

      if (result.error) {
        return { ok: false, error: result.error }
      }

      let imageUrl = ''
      if (result.imageUrls.length > 0) {
        const url = result.imageUrls[0]!
        try {
          imageUrl = url.startsWith('data:') ? url : await urlToDataUrl(url)
        } catch {
          imageUrl = url
        }
      }

      return {
        ok: true,
        label: result.palace?.theme || `记忆宫殿 (${selectedNodes.length} 站)`,
        stations: result.memoryRoute.map((s) => ({
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

  async runMindmapFromDoc(text: string, title: string): Promise<MindmapFromDocResult> {
    const graph = this.buildMindmapGraph({ enableHITL: false })
    const app = graph.compile()

    const initialState: typeof AgentStateWithHITL.State = {
      messages: [],
      context: null,
      intent: 'mindmap',
      response: '',
      error: '',
      mindmapInputText: text,
      mindmapInputTitle: title,
      mindmapNodes: [],
      mindmapEdges: [],
      mindmapTitle: '',
      interruptPoint: null,
      userConfirmedPrompt: null,
      userConfirmedStructure: null,
      palaceInputText: '',
      palaceInputNodes: [],
      memoryItems: [],
      palace: null,
      imagePrompt: '',
      imageUrls: [],
      detectedCoords: [],
      memoryRoute: [],
    }

    const result = await app.invoke(initialState)

    if (result.error) {
      throw new Error(result.error)
    }

    return {
      nodes: result.mindmapNodes,
      edges: result.mindmapEdges,
      documentTitle: result.mindmapTitle,
    }
  }

  private buildGraph(_?: MindmapContextData, options: { enableHITL?: boolean } = {}) {
    const { enableHITL = false } = options
    const { listKnowledgeBaseTool, searchDocumentsTool } = createSearchTools(
      this.aiService.vectorStore,
      this.aiService.indexer,
    )
    const tools = [listKnowledgeBaseTool, searchDocumentsTool]
    const profileText = this.aiService.userProfile.getText()

    const supervisor = new SupervisorAgent(this.provider, tools, profileText)
    const mindmapGen = new MindmapGenAgent(this.provider)

    // 构建 Palace Subgraph
    const palaceSubgraph = buildPalaceSubgraph({
      provider: this.provider,
      enableHITL,
    })

    // 状态映射包装器：将主图状态映射到 Subgraph 状态
    const palaceSubgraphWrapper = async (state: typeof AgentStateWithHITL.State): Promise<Partial<typeof AgentStateWithHITL.State>> => {
      try {
        // 编译并执行 Subgraph
        const app = palaceSubgraph.compile()
        const result = await app.invoke(state, { recursionLimit: 80 })

        // 映射结果回主图状态
        return {
          palaceInputText: result.palaceInputText,
          palaceInputNodes: result.palaceInputNodes,
          memoryItems: result.memoryItems,
          palace: result.palace,
          imagePrompt: result.imagePrompt,
          imageUrls: result.imageUrls,
          detectedCoords: result.detectedCoords,
          memoryRoute: result.memoryRoute,
          error: result.error,
          interruptPoint: result.interruptPoint,
          userConfirmedPrompt: result.userConfirmedPrompt,
        }
      } catch (error) {
        // 捕获 HITL 中断错误
        if (error instanceof HITLInterruptError) {
          // 将中断数据传递出去
          throw error
        }
        // 其他错误
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }

    const graph = new StateGraph(AgentStateWithHITL)
      .addNode('supervisor', (state) => supervisor.invoke(state))
      .addNode('tools', (state) => supervisor.invokeTools(state))
      .addNode('palaceSubgraph', palaceSubgraphWrapper)
      .addNode('mindmapGen', (state) => mindmapGen.invoke(state))

    // HITL 支持：mindmap 确认节点
    if (enableHITL) {
      const hitlMindmapNode = async (state: typeof AgentStateWithHITL.State): Promise<Partial<typeof AgentStateWithHITL.State>> => {
        // 如果用户已确认结构，使用确认后的值
        if (state.userConfirmedStructure) {
          return {
            mindmapNodes: state.userConfirmedStructure.nodes,
            mindmapEdges: state.userConfirmedStructure.edges,
            mindmapTitle: state.userConfirmedStructure.title,
            interruptPoint: null,
          }
        }

        // 触发 HITL 中断
        const interruptData: HITLMindmapData = {
          type: 'mindmapGen_confirmation',
          currentStructure: {
            nodes: state.mindmapNodes,
            edges: state.mindmapEdges,
            title: state.mindmapTitle,
          },
        }
        throw new HITLInterruptError(interruptData as unknown as HITLInterruptData)
      }

      graph.addNode('hitl_mindmap_check', hitlMindmapNode)
        .addEdge('mindmapGen', 'hitl_mindmap_check')
        .addConditionalEdges('hitl_mindmap_check', (state) => {
          if (state.error) return END
          if (state.userConfirmedStructure) return END
          return END
        })
    } else {
      graph.addEdge('mindmapGen', END)
    }

    graph
      .addEdge(START, 'supervisor')
      .addConditionalEdges('supervisor', (state) => supervisor.route(state))
      .addEdge('tools', 'supervisor')
      .addEdge('palaceSubgraph', END)

    return graph
  }

  private buildMindmapGraph(options: { enableHITL?: boolean } = {}) {
    const { enableHITL = false } = options
    const mindmapGen = new MindmapGenAgent(this.provider)

    const graph = new StateGraph(AgentStateWithHITL)
      .addNode('mindmapGen', (state) => mindmapGen.invoke(state))

    // 基础边
    graph.addEdge(START, 'mindmapGen')

    if (enableHITL) {
      const hitlNode = async (state: typeof AgentStateWithHITL.State): Promise<Partial<typeof AgentStateWithHITL.State>> => {
        if (state.userConfirmedStructure) {
          return {
            mindmapNodes: state.userConfirmedStructure.nodes,
            mindmapEdges: state.userConfirmedStructure.edges,
            mindmapTitle: state.userConfirmedStructure.title,
            interruptPoint: null,
          }
        }

        const interruptData: HITLMindmapData = {
          type: 'mindmapGen_confirmation',
          currentStructure: {
            nodes: state.mindmapNodes,
            edges: state.mindmapEdges,
            title: state.mindmapTitle,
          },
        }
        throw new HITLInterruptError(interruptData as unknown as HITLInterruptData)
      }

      graph.addNode('hitl_check', hitlNode)
      ;(graph as unknown as { addEdge: (from: string, to: string) => void }).addEdge('mindmapGen', 'hitl_check')
      graph.addConditionalEdges('hitl_check' as never, (state) => {
        if (state.error) return END
        return END
      })
    } else {
      graph.addEdge('mindmapGen', END)
    }

    return graph
  }

  /**
   * 构建响应对象
   */
  private buildResponse(
    result: typeof AgentStateWithHITL.State,
    streamingContent?: string,
  ): ChatResponse {
    const rawContent = streamingContent || result.response || '抱歉，我无法生成回复。'

    const response: ChatResponse = {
      content: stripIntentMarkers(rawContent),
      toolCalls: this.extractToolCalls(result.messages),
    }

    if (result.intent === 'mindmap' && result.mindmapNodes.length > 0) {
      response.mindmapData = this.mapMindmapResult(
        result.mindmapNodes,
        result.mindmapEdges,
        result.mindmapTitle,
      )
    }

    if (result.intent === 'palace' && result.memoryRoute.length > 0) {
      response.palaceData = {
        content: rawContent,
        imageUrls: result.imageUrls,
        memoryRoute: result.memoryRoute,
      }
    }

    return response
  }

  private async buildInputMessages(request: ChatRequest): Promise<BaseMessage[]> {
    const inputMessages: BaseMessage[] = []
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        inputMessages.push(new SystemMessage(msg.content))
      } else if (msg.role === 'user') {
        inputMessages.push(new HumanMessage(msg.content))
      } else if (msg.role === 'assistant') {
        inputMessages.push(new AIMessage(msg.content))
      }
    }
    return compressMessages(inputMessages, this.provider.reasoningModel)
  }

  private extractToolCalls(messages: BaseMessage[]): ChatResponse['toolCalls'] {
    const toolCalls: ChatResponse['toolCalls'] = []
    for (const msg of messages) {
      if (msg.getType() === 'tool') {
        const toolMsg = msg as BaseMessage & { name?: string; content: unknown }
        const name = toolMsg.name ?? 'unknown'
        const resultStr = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)
        toolCalls.push({ name, args: {}, result: resultStr })
      }
    }
    return toolCalls.length > 0 ? toolCalls : undefined
  }

  private mapMindmapResult(
    mindmapNodes: GeneratedNode[],
    mindmapEdges: GeneratedEdge[],
    mindmapTitle: string,
  ): ChatResponse['mindmapData'] {
    const mappedNodes = mindmapNodes.map((n) => {
      if (n.type === 'document') {
        return {
          id: n.id,
          type: 'document' as const,
          position: { x: 0, y: 0 },
          data: {
            filename: (n.data as { filename?: string }).filename ?? '',
            excerpt: (n.data as { excerpt?: string }).excerpt ?? '',
            fullTextPath: (n.data as { fullTextPath?: string }).fullTextPath,
          },
        }
      }
      return {
        id: n.id,
        type: 'topic' as const,
        position: { x: 0, y: 0 },
        data: { label: (n.data as { label?: string }).label ?? '' },
      }
    }) as MindLaneNode[]

    return {
      nodes: mappedNodes,
      edges: mindmapEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
      })),
      title: mindmapTitle || '生成的思维导图',
    }
  }

}
