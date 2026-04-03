import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { END, START, StateGraph, MemorySaver } from '@langchain/langgraph'
import type { LLMProvider } from './providers/index.js'
import { urlToDataUrl } from './providers/index.js'
import type { AiService } from './service.js'
import { compressMessages } from './memory/compression.js'
import { AgentState } from './state.js'
import type { SelectedNodeContent, MemoryPalaceStation, GeneratedNode, GeneratedEdge } from './state.js'
import { SupervisorAgent, stripIntentMarkers } from './agents/supervisor.js'
import { AnalyzeAgent } from './agents/analyze.js'
import { ImageGenAgent } from './agents/imageGen.js'
import { VisionAgent } from './agents/vision.js'
import { MindmapGenAgent } from './agents/mindmapGen.js'
import { createSearchTools } from './agents/tools/index.js'
import type { MindmapContextData } from './agents/tools/mindmapContext.js'
import type { MindLaneNode, MindLaneEdge } from '../../src/shared/lib/fileFormat.js'

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

export interface StreamCallbacks {
  onToken: (token: string) => void
  onToolStart: (name: string, input: Record<string, unknown>) => void
  onToolEnd: (name: string, output: string) => void
  onEnd: (response: ChatResponse) => void
  onError: (error: string) => void
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
    const graph = this.buildGraph(request.context)
    const app = graph.compile()

    const result = await app.invoke(
      { messages: compressed, context: request.context ?? null },
      { recursionLimit: 80 },
    )

    const response: ChatResponse = {
      content: stripIntentMarkers(result.response || '') || '抱歉，我无法生成回复。',
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
      response.palaceData = await this.mapPalaceResult(result)
    }

    return response
  }

  async stream(
    request: ChatRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const compressed = await this.buildInputMessages(request)
    const graph = this.buildGraph(request.context)
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
      const result = snapshot.values as typeof AgentState.State

      const rawContent = result.response || fullContent || '抱歉，我无法生成回复。'
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
        response.palaceData = await this.mapPalaceResult({
          response: rawContent,
          imageUrls: result.imageUrls,
          memoryRoute: result.memoryRoute,
        })
      }

      callbacks.onEnd(response)
    } catch (err) {
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

    const graph = this.buildPalaceGraph()
    const app = graph.compile()

    try {
      const result = await app.invoke(
        { intent: 'palace' as const, palaceInputNodes: selectedNodes },
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
    const graph = this.buildMindmapGraph()
    const app = graph.compile()

    const result = await app.invoke({
      mindmapInputText: text,
      mindmapInputTitle: title,
    })

    if (result.error) {
      throw new Error(result.error)
    }

    return {
      nodes: result.mindmapNodes,
      edges: result.mindmapEdges,
      documentTitle: result.mindmapTitle,
    }
  }

  private buildGraph(_context?: MindmapContextData) {
    const { listKnowledgeBaseTool, searchDocumentsTool } = createSearchTools(
      this.aiService.vectorStore,
      this.aiService.indexer,
    )
    const tools = [listKnowledgeBaseTool, searchDocumentsTool]
    const profileText = this.aiService.userProfile.getText()

    const supervisor = new SupervisorAgent(this.provider, tools, profileText)
    const analyze = new AnalyzeAgent(this.provider)
    const imageGen = new ImageGenAgent(this.provider)
    const vision = new VisionAgent(this.provider)
    const mindmapGen = new MindmapGenAgent(this.provider)

    return new StateGraph(AgentState)
      .addNode('supervisor', (state) => supervisor.invoke(state))
      .addNode('tools', (state) => supervisor.invokeTools(state))
      .addNode('analyze', (state) => analyze.invoke(state))
      .addNode('imageGen', (state) => imageGen.invoke(state))
      .addNode('vision', (state) => vision.invoke(state))
      .addNode('mindmapGen', (state) => mindmapGen.invoke(state))
      .addEdge(START, 'supervisor')
      .addConditionalEdges('supervisor', (state) => supervisor.route(state))
      .addEdge('tools', 'supervisor')
      .addEdge('analyze', 'imageGen')
      .addEdge('imageGen', 'vision')
      .addEdge('vision', END)
      .addEdge('mindmapGen', END)
  }

  private buildPalaceGraph() {
    const analyze = new AnalyzeAgent(this.provider)
    const imageGen = new ImageGenAgent(this.provider)
    const vision = new VisionAgent(this.provider)

    return new StateGraph(AgentState)
      .addNode('analyze', (state) => analyze.invoke(state))
      .addNode('imageGen', (state) => imageGen.invoke(state))
      .addNode('vision', (state) => vision.invoke(state))
      .addEdge(START, 'analyze')
      .addEdge('analyze', 'imageGen')
      .addEdge('imageGen', 'vision')
      .addEdge('vision', END)
  }

  private buildMindmapGraph() {
    const mindmapGen = new MindmapGenAgent(this.provider)

    return new StateGraph(AgentState)
      .addNode('mindmapGen', (state) => mindmapGen.invoke(state))
      .addEdge(START, 'mindmapGen')
      .addEdge('mindmapGen', END)
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
      if (msg._getType() === 'tool') {
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

  private async mapPalaceResult(result: {
    response: string
    imageUrls: string[]
    memoryRoute: MemoryPalaceStation[]
  }): Promise<ChatResponse['palaceData']> {
    let imageUrls = result.imageUrls
    if (imageUrls.length > 0) {
      imageUrls = await Promise.all(
        imageUrls.map(async (url) => {
          if (url.startsWith('data:')) return url
          try { return await urlToDataUrl(url) } catch { return url }
        }),
      )
    }
    return {
      content: result.response,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      memoryRoute: result.memoryRoute,
    }
  }
}
