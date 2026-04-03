import { AIMessage, SystemMessage } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { LLMProvider } from '../providers/index.js'
import type { AgentState } from '../state.js'
import type { MindmapContextData } from './tools/mindmapContext.js'

const INTENT_PALACE_RE = /\[INTENT:palace\]/i
const INTENT_MINDMAP_RE = /\[INTENT:mindmap\]/i
const PALACE_INPUT_RE = /\[PALACE_INPUT:([\s\S]*?)\]/
const MINDMAP_INPUT_RE = /\[MINDMAP_INPUT:([\s\S]*?)\]/
const MINDMAP_TITLE_RE = /\[MINDMAP_TITLE:([\s\S]*?)\]/

function stripIntentMarkers(text: string): string {
  return text
    .replace(/\[INTENT:\w+\]/gi, '')
    .replace(/\[PALACE_INPUT:[\s\S]*?\]/g, '')
    .replace(/\[MINDMAP_INPUT:[\s\S]*?\]/g, '')
    .replace(/\[MINDMAP_TITLE:[\s\S]*?\]/g, '')
    .trim()
}

export class SupervisorAgent {
  private modelWithTools: ReturnType<NonNullable<typeof this.provider.reasoningModel.bindTools>>
  private toolNode: ToolNode

  constructor(
    private provider: LLMProvider,
    tools: StructuredToolInterface[],
    private profileText: string,
  ) {
    this.modelWithTools = provider.reasoningModel.bindTools!(tools)
    this.toolNode = new ToolNode(tools)
  }

  async invoke(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
    const systemPrompt = this.buildSystemPrompt(state.context)
    const messagesWithSystem = [new SystemMessage(systemPrompt), ...state.messages]

    const response = await this.modelWithTools.invoke(messagesWithSystem)

    const content = typeof response.content === 'string' ? response.content : ''
    const toolCalls = (response as AIMessage).tool_calls ?? []

    if (toolCalls.length > 0) {
      return { messages: [response] }
    }

    if (INTENT_PALACE_RE.test(content)) {
      const palaceMatch = PALACE_INPUT_RE.exec(content)
      const palaceInput = palaceMatch?.[1]?.trim() ?? ''
      const cleanResponse = stripIntentMarkers(content)

      return {
        messages: [response],
        intent: 'palace',
        palaceInputText: palaceInput,
        response: cleanResponse,
      }
    }

    if (INTENT_MINDMAP_RE.test(content)) {
      const inputMatch = MINDMAP_INPUT_RE.exec(content)
      const titleMatch = MINDMAP_TITLE_RE.exec(content)
      const mindmapInput = inputMatch?.[1]?.trim() ?? ''
      const mindmapTitle = titleMatch?.[1]?.trim() ?? ''
      const cleanResponse = stripIntentMarkers(content)

      return {
        messages: [response],
        intent: 'mindmap',
        mindmapInputText: mindmapInput,
        mindmapInputTitle: mindmapTitle,
        response: cleanResponse,
      }
    }

    return {
      messages: [response],
      intent: 'qa',
      response: content,
    }
  }

  async invokeTools(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
    const result = await this.toolNode.invoke(state)
    const messages = result.messages ?? result
    return { messages: Array.isArray(messages) ? messages : [messages] }
  }

  route(state: typeof AgentState.State): string {
    const lastMessage = state.messages[state.messages.length - 1]
    if (lastMessage && '_getType' in lastMessage) {
      const msg = lastMessage as AIMessage
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        return 'tools'
      }
    }

    switch (state.intent) {
      case 'palace':
        return 'analyze'
      case 'mindmap':
        return 'mindmapGen'
      default:
        return '__end__'
    }
  }

  private buildSystemPrompt(context?: MindmapContextData | null): string {
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
      '- 关于当前状态的问题（工作区文件、打开的文件、选中的节点等），直接从下方提供的"当前状态"部分回答，不需要调用任何工具。',
      '- 如果搜索后确实没有相关结果，再如实告知用户知识库中暂无相关内容。',
      '',
      '意图判断规则：',
      '- 当用户要求记忆内容、使用记忆宫殿法、空间记忆法时，你必须在最终回复中包含 [INTENT:palace] 标记，并在 [PALACE_INPUT:...] 中提取要记忆的内容。',
      '- 当用户要求生成思维导图时，你必须在最终回复中包含 [INTENT:mindmap] 标记，并在 [MINDMAP_INPUT:...] 和可选的 [MINDMAP_TITLE:...] 中提取内容。',
      '- 其他情况为普通问答，直接回答即可。',
      '',
      '工具使用规则（严格遵守，尽量少调用工具）：',
      '- 以下场景不需要调用任何工具，直接回答：打招呼、询问你的能力、关于当前状态的问题、闲聊、生成思维导图或记忆宫殿的意图判断。',
      '- searchDocuments：仅当用户的问题明确涉及具体知识内容（如某本书、某个概念、某篇文档的细节）时才使用，一次调用足够，不要重复搜索。',
      '- listKnowledgeBase：仅当用户明确询问"知识库有什么"、"有哪些文档"时使用。',
      '- 如果一个问题可以不调用工具就回答，就不要调用工具。',
      '- 回答问题时请简洁专业，使用中文。',
    ]

    if (this.profileText) {
      parts.push('', '用户画像：', this.profileText)
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
}
