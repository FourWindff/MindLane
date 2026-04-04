import { AIMessage, SystemMessage } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { LLMProvider } from '../providers/index.js'
import type { AgentState } from '../state.js'
import type { MindmapContextData } from './tools/mindmapContext.js'

/**
 * 路由决定 Schema - 使用 Zod 定义结构化输出
 */
const RouteDecisionSchema = z.object({
  /** 路由目标 */
  target: z.enum(['qa', 'mindmap', 'palace']),
  /** 原因说明 */
  reason: z.string().optional(),
  /** 附带的参数 */
  parameters: z.object({
    /** 思维导图生成的输入内容 */
    mindmapInput: z.string().optional(),
    /** 思维导图标题 */
    mindmapTitle: z.string().optional(),
    /** 记忆宫殿的输入内容 */
    palaceInput: z.string().optional(),
  }).optional(),
})

type RouteDecision = z.infer<typeof RouteDecisionSchema>


/**
 * SupervisorAgent - 使用结构化输出进行路由决策
 *
 * 工作原理：
 * 1. 在 system prompt 中告诉 LLM 输出 JSON 格式的路由决定
 * 2. LLM 在回复中嵌入路由 JSON
 * 3. SupervisorAgent 解析 JSON，提取路由决定
 * 4. 无需复杂的正则解析，直接获得结构化输出
 */
export class SupervisorAgent {
  private toolNode: ToolNode

  constructor(
    private provider: LLMProvider,
    private tools: StructuredToolInterface[],
    private profileText: string,
  ) {
    this.toolNode = new ToolNode(tools)
  }

  async invoke(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
    const systemPrompt = this.buildSystemPrompt(state.context)
    const messagesWithSystem = [new SystemMessage(systemPrompt), ...state.messages]

    // 使用带工具的模型（用于知识库搜索等）
    const modelWithTools = this.provider.reasoningModel.bindTools!(this.tools)

    const response = await modelWithTools.invoke(messagesWithSystem)
    const content = typeof response.content === 'string' ? response.content : ''
    const toolCalls = (response as AIMessage).tool_calls ?? []

    // 优先检查是否是工具调用（知识库搜索等）
    if (toolCalls.length > 0) {
      return { messages: [response] }
    }

    // 使用结构化输出获取路由决定
    const routeDecision = await this.getRouteDecision(state)
    if (routeDecision) {
      return this.applyRouteDecision(response, routeDecision, content)
    }

    // 默认 QA 模式
    return {
      messages: [response],
      intent: 'qa',
      response: content,
    }
  }

  /**
   * 使用 LangChain 的 withStructuredOutput 获取路由决定
   */
  private async getRouteDecision(state: typeof AgentState.State): Promise<RouteDecision | null> {
    try {
      // 使用 withStructuredOutput 强制模型输出符合 schema 的结构化数据
      const structuredModel = this.provider.reasoningModel.withStructuredOutput(RouteDecisionSchema, {
        name: 'routeDecision',
      })

      const systemPrompt = this.buildRouteDecisionPrompt(state.context)
      const messagesWithSystem = [new SystemMessage(systemPrompt), ...state.messages]

      const decision = await structuredModel.invoke(messagesWithSystem)
      return decision as RouteDecision
    } catch {
      // 如果结构化输出失败，返回 null，让调用方使用默认 QA 模式
      return null
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

    // 根据意图路由
    switch (state.intent) {
      case 'palace':
        return 'palaceSubgraph'
      case 'mindmap':
        return 'mindmapGen'
      default:
        return '__end__'
    }
  }

  /**
   * 应用路由决定到状态
   */
  private applyRouteDecision(
    response: AIMessage,
    decision: RouteDecision,
    content: string
  ): Partial<typeof AgentState.State> {
    const cleanResponse = content

    switch (decision.target) {
      case 'mindmap':
        return {
          messages: [response],
          intent: 'mindmap',
          mindmapInputText: decision.parameters?.mindmapInput || cleanResponse,
          mindmapInputTitle: decision.parameters?.mindmapTitle || '思维导图',
          response: cleanResponse,
        }
      case 'palace':
        return {
          messages: [response],
          intent: 'palace',
          palaceInputText: decision.parameters?.palaceInput || cleanResponse,
          response: cleanResponse,
        }
      case 'qa':
      default:
        return {
          messages: [response],
          intent: 'qa',
          response: cleanResponse,
        }
    }
  }

  /**
   * 构建路由决策专用提示词
   * 告诉模型如何决定路由，但不涉及具体输出格式（由 withStructuredOutput 处理）
   */
  private buildRouteDecisionPrompt(context?: MindmapContextData | null): string {
    const parts = [
      '你是 MindLane 的路由决策助手。根据用户的输入，决定应该路由到哪个功能模块。',
      '',
      '## 路由选项',
      '',
      '- `qa`: 普通问答、闲聊、知识库搜索、询问当前状态',
      '- `mindmap`: 用户要求生成思维导图、大纲、或可视化概念',
      '- `palace`: 用户要求生成记忆宫殿、使用记忆法、或记忆特定内容',
      '',
      '## 决策规则',
      '',
      '- 用户明确说"生成思维导图"、"帮我做个大纲"、"可视化这个概念" → mindmap',
      '- 用户明确说"生成记忆宫殿"、"用这个记忆法"、"帮我记住这个" → palace',
      '- 其他所有情况 → qa',
      '',
      '## 参数填充',
      '',
      '- mindmapInput: 用户想要生成思维导图的主题或内容',
      '- mindmapTitle: 思维导图的标题（如果用户没指定，用主题作为标题）',
      '- palaceInput: 用户想要记忆的内容',
    ]

    if (context?.mindmapSummary) {
      parts.push('', '## 当前思维导图上下文', context.mindmapSummary)
    }

    return parts.join('\n')
  }

  private buildSystemPrompt(context?: MindmapContextData | null): string {
    const parts = [
      '你是 MindLane 的 AI 助手，帮助用户进行思维导图创作、知识管理和记忆训练。',
      '',
      '## 你的能力',
      '',
      '1. **直接生成思维导图**：系统会自动将思维导图节点渲染到用户当前的画布上',
      '2. **生成记忆宫殿**：系统会创建包含场景图和站点的记忆宫殿节点',
      '3. **知识库问答**：直接回答问题，或使用 searchDocuments 工具检索用户导入的知识库文档',
      '4. **感知当前状态**：你自动感知用户当前正在编辑的思维导图内容、选中的节点、工作区文件等',
      '',
      '## 核心原则',
      '',
      '- 你拥有用户的个人知识库，里面存储了用户导入的各种文档资料。',
      '- 关于当前状态的问题（工作区文件、打开的文件、选中的节点等），直接根据下方提供的"当前状态"回答，不需要调用任何工具。',
      '- 如果搜索后确实没有相关结果，再如实告知用户知识库中暂无相关内容。',
      '- 当用户问你是否能生成思维导图或记忆宫殿时，你应当肯定地回答"可以"，因为你确实拥有这个能力。',
      '',
      '## 工具使用原则',
      '',
      '- **尽量少调用工具**：打招呼、询问能力、关于当前状态的问题、闲聊，都不需要调用工具。',
      '- `searchDocuments`：仅当用户的问题明确涉及具体知识内容（如某本书、某个概念、某篇文档的细节）时才使用。',
      '- `listKnowledgeBase`：仅当用户明确询问"知识库有什么"、"有哪些文档"时使用。',
      '- 如果一个简单问题可以不调用工具就回答，就不要调用工具。',
      '- 回答问题时请简洁专业，使用中文。',
    ]

    if (this.profileText) {
      parts.push('', '## 用户画像', this.profileText)
    }

    parts.push('', '## 当前状态')

    if (context?.workspacePath) {
      parts.push(`工作区路径: ${context.workspacePath}`)
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
      parts.push('当前思维导图概览：', context.mindmapSummary)
    } else if (context?.mindmapSummary) {
      parts.push('', '当前思维导图概览：', context.mindmapSummary)
    } else {
      parts.push('', '当前没有打开任何思维导图文件。')
    }

    if (context?.selectedNodes && context.selectedNodes.length > 0) {
      const nodeLines = context.selectedNodes.map((n) => {
        switch (n.type) {
          case 'palace': {
            const sc = n.extra?.stationCount ?? 0
            return `- [宫殿] ${n.label} (${sc}个站点)`
          }
          case 'document': {
            const exc = n.extra?.excerpt ? ` — ${String(n.extra.excerpt).slice(0, 60)}` : ''
            return `- [文档] ${n.label}${exc}`
          }
          default:
            return `- [主题] ${n.label}`
        }
      })
      parts.push('', '当前选中的节点：', ...nodeLines)
    } else {
      parts.push('', '当前没有选中任何节点。')
    }

    parts.push('', '## 当前状态结束')

    return parts.join('\n')
  }
}
