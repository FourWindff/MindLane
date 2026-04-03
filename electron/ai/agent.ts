import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { LLMProvider } from './providers/index.js'
import type { AiService } from './service.js'
import { urlToDataUrl } from './providers/index.js'
import { compressMessages } from './memory/compression.js'
import { buildGraph, buildPalaceGraph } from './graph.js'
import type { MindmapContextData } from './agents/tools/mindmapContext.js'
import type { MindLaneNode, MindLaneEdge } from '../../src/shared/lib/fileFormat.js'
import type { SelectedNodeContent, MemoryPalaceStation } from './state.js'

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

async function buildInputMessages(
  request: ChatRequest,
  model: BaseChatModel,
): Promise<BaseMessage[]> {
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
  return compressMessages(inputMessages, model)
}

function extractToolCalls(messages: BaseMessage[]): ChatResponse['toolCalls'] {
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

export async function runAgent(params: {
  request: ChatRequest
  model: BaseChatModel
  provider: LLMProvider
  aiService: AiService
  apiKey: string
  modelName: string
}): Promise<ChatResponse> {
  const { request, model, provider, aiService, apiKey, modelName } = params

  const compressed = await buildInputMessages(request, model)

  const graph = buildGraph({
    model,
    reasoningModel: provider.reasoningModel,
    runtime: provider,
    aiService,
    apiKey,
    modelName,
    context: request.context,
  })

  const app = graph.compile()

  const result = await app.invoke(
    {
      messages: compressed,
      context: request.context ?? null,
    },
    { recursionLimit: 80 },
  )

  const response: ChatResponse = {
    content: result.response || '抱歉，我无法生成回复。',
    toolCalls: extractToolCalls(result.messages),
  }

  if (result.intent === 'mindmap' && result.mindmapNodes.length > 0) {
    const mappedNodes = result.mindmapNodes.map((n: typeof result.mindmapNodes[0]) => {
      if (n.type === 'document') {
        return {
          id: n.id,
          type: 'document' as const,
          position: n.position,
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
        position: n.position,
        data: { label: (n.data as { label?: string }).label ?? '' },
      }
    }) as MindLaneNode[]
    response.mindmapData = {
      nodes: mappedNodes,
      edges: result.mindmapEdges.map((e: typeof result.mindmapEdges[0]) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
      })),
      title: result.mindmapTitle || '生成的思维导图',
    }
  }

  if (result.intent === 'palace' && result.memoryRoute.length > 0) {
    let imageUrls = result.imageUrls as string[]
    if (imageUrls.length > 0) {
      imageUrls = await Promise.all(
        imageUrls.map(async (url: string) => {
          if (url.startsWith('data:')) return url
          try { return await urlToDataUrl(url) } catch { return url }
        }),
      )
    }
    response.palaceData = {
      content: result.response,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      memoryRoute: result.memoryRoute,
    }
  }

  return response
}

export async function streamAgent(
  params: {
    request: ChatRequest
    model: BaseChatModel
    provider: LLMProvider
    aiService: AiService
    apiKey: string
    modelName: string
    signal?: AbortSignal
  },
  callbacks: StreamCallbacks,
): Promise<void> {
  const { request, model, provider, aiService, apiKey, modelName } = params

  const compressed = await buildInputMessages(request, model)

  const graph = buildGraph({
    model,
    reasoningModel: provider.reasoningModel,
    runtime: provider,
    aiService,
    apiKey,
    modelName,
    context: request.context,
  })

  const app = graph.compile()

  let fullContent = ''

  try {
    const stream = app.streamEvents(
      {
        messages: compressed,
        context: request.context ?? null,
      },
      { version: 'v2' as const, signal: params.signal, recursionLimit: 80 },
    )

    for await (const event of stream) {
      if (params.signal?.aborted) break

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

    const finalResult = await app.invoke(
      {
        messages: compressed,
        context: request.context ?? null,
      },
      { recursionLimit: 80 },
    )

    const response: ChatResponse = {
      content: finalResult.response || fullContent || '抱歉，我无法生成回复。',
      toolCalls: extractToolCalls(finalResult.messages),
    }

    if (finalResult.intent === 'mindmap' && finalResult.mindmapNodes.length > 0) {
      const streamMappedNodes = finalResult.mindmapNodes.map((n: typeof finalResult.mindmapNodes[0]) => {
        if (n.type === 'document') {
          return {
            id: n.id,
            type: 'document' as const,
            position: n.position,
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
          position: n.position,
          data: { label: (n.data as { label?: string }).label ?? '' },
        }
      }) as MindLaneNode[]
      response.mindmapData = {
        nodes: streamMappedNodes,
        edges: finalResult.mindmapEdges,
        title: finalResult.mindmapTitle || '生成的思维导图',
      }
    }

    if (finalResult.intent === 'palace' && finalResult.memoryRoute.length > 0) {
      let imageUrls = finalResult.imageUrls as string[]
      if (imageUrls.length > 0) {
        imageUrls = await Promise.all(
          imageUrls.map(async (url: string) => {
            if (url.startsWith('data:')) return url
            try { return await urlToDataUrl(url) } catch { return url }
          }),
        )
      }
      response.palaceData = {
        content: finalResult.response,
        ...(imageUrls.length > 0 ? { imageUrls } : {}),
        memoryRoute: finalResult.memoryRoute,
      }
    }

    callbacks.onEnd(response)
  } catch (err) {
    if (params.signal?.aborted) {
      callbacks.onEnd({
        content: fullContent || '（已停止生成）',
      })
      return
    }
    callbacks.onError(err instanceof Error ? err.message : String(err))
  }
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

export async function runPalaceFromNodes(params: {
  selectedNodes: SelectedNodeContent[]
  provider: LLMProvider
}): Promise<NodesToPalaceResult> {
  const { selectedNodes, provider } = params

  if (selectedNodes.length === 0) {
    return { ok: false, error: '未选中任何节点' }
  }

  const graph = buildPalaceGraph({
    reasoningModel: provider.reasoningModel,
    runtime: provider,
  })

  const app = graph.compile()

  try {
    const result = await app.invoke(
      {
        intent: 'palace' as const,
        palaceInputNodes: selectedNodes,
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
