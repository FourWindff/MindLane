import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type { AiRuntime } from './runtime.js'
import type { MindLaneNode, MindLaneEdge } from '../../src/shared/lib/fileFormat.js'
import { searchDocumentsTool, listKnowledgeBaseTool } from './tools/searchDocuments.js'
import { createGenerateMindmapTool, type MindmapToolResult } from './tools/generateMindmap.js'
import { createGeneratePalaceTool } from './tools/generatePalace.js'
import {
  getMindmapContextTool,
  getSelectedNodesTool,
  listWorkspaceFilesTool,
  setMindmapContext,
  type MindmapContextData,
} from './tools/mindmapContext.js'
import { getUserProfileText } from './memory/userProfile.js'
import { compressMessages } from './memory/compression.js'

function buildSystemPrompt(context?: MindmapContextData): string {
  const parts = [
    '你是 MindLane 的 AI 助手，帮助用户进行思维导图创作、知识管理和记忆训练。',
    '',
    '你的能力：',
    '1. 根据用户输入的内容生成结构化的思维导图（包含 topic 主题节点和 document 文档节点）',
    '2. 使用记忆宫殿法帮助用户记忆知识点（生成 palace 宫殿节点）',
    '3. 检索用户导入的知识库文档，回答相关问题',
    '4. 感知用户当前正在编辑的思维导图内容和选中的节点',
    '5. 查看当前工作区中的文件列表',
    '',
    '导图节点类型说明：',
    '- topic: 主题节点，核心数据是 label（文本标签）',
    '- palace: 记忆宫殿节点，包含 label、imageUrl（场景图）、stations（记忆站点列表）、sourceNodeIds',
    '- document: 文档节点，包含 filename（文件名）和 excerpt（摘要）',
    '',
    '核心原则：',
    '- 你拥有用户的个人知识库，里面存储了用户导入的各种文档资料。',
    '- 当用户提问时，如果问题有任何可能与知识库内容相关（包括但不限于个人经历、项目、笔记、学习资料等），你必须先使用 searchDocuments 工具搜索知识库，基于搜索结果来回答。',
    '- 不要在没有搜索的情况下说"无法访问"或"没有相关信息"。始终先搜索再回答。',
    '- 如果搜索后确实没有相关结果，再如实告知用户知识库中暂无相关内容。',
    '- 关于当前状态的问题（工作区文件、打开的文件、选中的节点等），直接从下方提供的上下文信息回答，不需要调用工具。',
    '',
    '工具使用规则：',
    '- searchDocuments：用户提出任何问题时，优先使用此工具在知识库中搜索相关内容。这是你最常用的工具。',
    '- listKnowledgeBase：当用户询问知识库有什么、有哪些文档、知识库状态时使用。',
    '- generateMindmap：当用户要求生成思维导图时使用。',
    '- generatePalace：当用户要求记忆内容时使用。',
    '- getMindmapContext：当需要了解用户当前导图的完整内容（包含工作区和导图结构）时使用。',
    '- getSelectedNodes：当需要了解用户选中了哪些节点时使用。',
    '- listWorkspaceFiles：当需要了解工作区有哪些文件时使用。',
    '- 回答问题时请简洁专业，使用中文。',
  ]

  const profileText = getUserProfileText()
  if (profileText) {
    parts.push('', '用户画像：', profileText)
  }

  parts.push('', '===== 当前状态 =====')

  if (context?.workspacePath) {
    parts.push(`当前工作区路径: ${context.workspacePath}`)
    if (context.workspaceFiles && context.workspaceFiles.length > 0) {
      const fileLines = context.workspaceFiles.map((f) => `  - ${f.name}`)
      parts.push(`工作区文件（共 ${context.workspaceFiles.length} 个）:`, ...fileLines)
    } else {
      parts.push('工作区中暂无文件。')
    }
  } else {
    parts.push('当前未打开任何工作区。')
  }

  if (context?.hasDocumentOpen && context.mindmapSummary) {
    if (context.filePath) {
      parts.push('', `当前打开的文件: ${context.filePath}`)
    }
    parts.push('当前打开的思维导图：', context.mindmapSummary)
  } else if (context?.mindmapSummary) {
    parts.push('', '当前打开的思维导图：', context.mindmapSummary)
  } else {
    parts.push('', '当前没有打开任何思维导图文件。')
  }

  if (context?.selectedNodes && context.selectedNodes.length > 0) {
    const nodeLines = context.selectedNodes.map((n) => {
      switch (n.type) {
        case 'palace': {
          const sc = n.extra?.stationCount ?? 0
          return `- [宫殿] ${n.label} (${sc}个站点, id: ${n.id})`
        }
        case 'document': {
          const exc = n.extra?.excerpt ? ` — ${String(n.extra.excerpt).slice(0, 60)}` : ''
          return `- [文档] ${n.label}${exc} (id: ${n.id})`
        }
        default:
          return `- [主题] ${n.label} (id: ${n.id})`
      }
    })
    parts.push('', '用户当前选中的节点：', ...nodeLines)
  } else {
    parts.push('', '当前没有选中任何节点。')
  }

  parts.push('===== 当前状态结束 =====')

  return parts.join('\n')
}

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
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onToolStart: (name: string, input: Record<string, unknown>) => void
  onToolEnd: (name: string, output: string) => void
  onEnd: (response: ChatResponse) => void
  onError: (error: string) => void
}

function buildAgent(params: {
  request: ChatRequest
  model: BaseChatModel
  runtime: AiRuntime
  checkpointer: SqliteSaver | null
  apiKey: string
  modelName: string
}) {
  const { request, model, runtime, checkpointer, apiKey, modelName } = params

  if (request.context) {
    setMindmapContext(request.context)
  }

  const tools = [
    listKnowledgeBaseTool,
    searchDocumentsTool,
    createGenerateMindmapTool(apiKey, modelName),
    createGeneratePalaceTool(apiKey, modelName, runtime),
    getMindmapContextTool,
    getSelectedNodesTool,
    listWorkspaceFilesTool,
  ]

  const systemPrompt = buildSystemPrompt(request.context)

  const agent = createReactAgent({
    llm: model,
    tools,
    checkpointSaver: checkpointer ?? undefined,
    prompt: systemPrompt,
  })

  return { agent, systemPrompt }
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

function extractResponseData(responseMessages: BaseMessage[]): Omit<ChatResponse, 'content'> {
  const toolCalls: ChatResponse['toolCalls'] = []
  let mindmapData: ChatResponse['mindmapData'] | undefined

  for (const msg of responseMessages) {
    if (msg._getType() === 'tool') {
      const toolMsg = msg as BaseMessage & { name?: string; content: unknown }
      const name = toolMsg.name ?? 'unknown'
      const resultStr = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)

      toolCalls.push({ name, args: {}, result: resultStr })

      if (name === 'generateMindmap') {
        try {
          const parsed = JSON.parse(resultStr) as MindmapToolResult
          if (parsed.success && parsed.nodes && parsed.edges) {
            mindmapData = {
              nodes: parsed.nodes,
              edges: parsed.edges,
              title: parsed.title ?? '生成的思维导图',
            }
          }
        } catch { /* not valid JSON, skip */ }
      }
    }
  }

  return {
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(mindmapData ? { mindmapData } : {}),
  }
}

export async function runAgent(params: {
  request: ChatRequest
  model: BaseChatModel
  runtime: AiRuntime
  checkpointer: SqliteSaver | null
  apiKey: string
  modelName: string
}): Promise<ChatResponse> {
  const { agent } = buildAgent(params)
  const compressed = await buildInputMessages(params.request, params.model)

  const config = params.checkpointer
    ? { configurable: { thread_id: params.request.threadId } }
    : undefined

  const result = await agent.invoke({ messages: compressed }, config)

  const responseMessages: BaseMessage[] = result.messages ?? []
  const lastAiMessage = [...responseMessages].reverse().find((m) => m._getType() === 'ai')
  const content = lastAiMessage
    ? typeof lastAiMessage.content === 'string'
      ? lastAiMessage.content
      : String(lastAiMessage.content)
    : ''

  return {
    content: content || '抱歉，我无法生成回复。',
    ...extractResponseData(responseMessages),
  }
}

export async function streamAgent(
  params: {
    request: ChatRequest
    model: BaseChatModel
    runtime: AiRuntime
    checkpointer: SqliteSaver | null
    apiKey: string
    modelName: string
    signal?: AbortSignal
  },
  callbacks: StreamCallbacks,
): Promise<void> {
  const { agent } = buildAgent(params)
  const compressed = await buildInputMessages(params.request, params.model)

  const config = {
    ...(params.checkpointer
      ? { configurable: { thread_id: params.request.threadId } }
      : {}),
    version: 'v2' as const,
    signal: params.signal,
  }

  let fullContent = ''
  const allMessages: BaseMessage[] = []

  try {
    const stream = agent.streamEvents(
      { messages: compressed },
      config,
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
      } else if (event.event === 'on_chain_end' && event.name === 'LangGraph') {
        const messages = event.data?.output?.messages
        if (Array.isArray(messages)) {
          allMessages.push(...(messages as BaseMessage[]))
        }
      }
    }

    const extraData = extractResponseData(allMessages)

    callbacks.onEnd({
      content: fullContent || '抱歉，我无法生成回复。',
      ...extraData,
    })
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
