import type { MindmapContextData, ContextNodeInfo } from '../agents/tools/mindmapContext.js'

/**
 * 上下文片段类型 - 定义不同类型的上下文内容
 */
export type ContextSection =
  | { type: 'system'; content: string }
  | { type: 'userProfile'; profileText: string }
  | { type: 'workspace'; path: string; files: { name: string; filePath: string }[] }
  | { type: 'mindmap'; summary?: string; filePath?: string; fileTitle?: string }
  | { type: 'selectedNodes'; nodes: ContextNodeInfo[] }
  | { type: 'custom'; title: string; content: string }

/**
 * 上下文构建器 - 统一管理多 agent 的上下文生成
 *
 * 使用方式:
 * const builder = new ContextBuilder(context)
 * const prompt = builder
 *   .addSystem('你是思维导图助手')
 *   .addUserProfile()
 *   .addWorkspace()
 *   .addMindmap()
 *   .addSelectedNodes()
 *   .build()
 */
export class ContextBuilder {
  private sections: ContextSection[] = []

  constructor(private context?: MindmapContextData | null) {}

  /**
   * 添加系统角色定义
   */
  addSystem(content: string): this {
    this.sections.push({ type: 'system', content })
    return this
  }

  /**
   * 添加用户画像
   */
  addUserProfile(profileText?: string): this {
    if (profileText) {
      this.sections.push({ type: 'userProfile', profileText })
    }
    return this
  }

  /**
   * 添加工作区信息
   */
  addWorkspace(): this {
    if (!this.context?.workspacePath) {
      this.sections.push({
        type: 'custom',
        title: '工作区',
        content: '当前未打开任何工作区。',
      })
      return this
    }

    const files = this.context.workspaceFiles ?? []
    this.sections.push({
      type: 'workspace',
      path: this.context.workspacePath,
      files: files.map((f) => ({ name: f.name, filePath: f.filePath })),
    })
    return this
  }

  /**
   * 添加思维导图信息
   */
  addMindmap(): this {
    const hasMindmap = this.context?.hasDocumentOpen || this.context?.mindmapSummary

    if (!hasMindmap) {
      this.sections.push({
        type: 'custom',
        title: '思维导图',
        content: '当前没有打开任何思维导图文件。',
      })
      return this
    }

    this.sections.push({
      type: 'mindmap',
      summary: this.context?.mindmapSummary,
      filePath: this.context?.filePath,
      fileTitle: this.context?.fileTitle,
    })
    return this
  }

  /**
   * 添加选中节点信息
   */
  addSelectedNodes(): this {
    const nodes = this.context?.selectedNodes ?? []

    if (nodes.length === 0) {
      this.sections.push({
        type: 'custom',
        title: '选中节点',
        content: '当前没有选中任何节点。',
      })
      return this
    }

    this.sections.push({ type: 'selectedNodes', nodes })
    return this
  }

  /**
   * 添加自定义内容
   */
  addCustom(title: string, content: string): this {
    this.sections.push({ type: 'custom', title, content })
    return this
  }

  /**
   * 构建为文本格式（用于 system prompt）
   */
  build(): string {
    const parts: string[] = []

    for (const section of this.sections) {
      switch (section.type) {
        case 'system':
          parts.push(section.content)
          break

        case 'userProfile':
          parts.push('', '用户画像：', section.profileText)
          break

        case 'workspace':
          parts.push('', `当前工作区路径: ${section.path}`)
          if (section.files.length > 0) {
            const fileLines = section.files.map((f) => `  - ${f.name}`)
            parts.push(`工作区文件（共 ${section.files.length} 个）:`, ...fileLines)
          } else {
            parts.push('工作区中暂无文件。')
          }
          break

        case 'mindmap':
          parts.push('')
          if (section.filePath) {
            parts.push(`当前打开的文件: ${section.filePath}`)
          }
          if (section.summary) {
            parts.push('当前打开的思维导图：', section.summary)
          }
          break

        case 'selectedNodes':
          parts.push('', '用户当前选中的节点：', ...section.nodes.map(formatNodeForContext))
          break

        case 'custom':
          parts.push('', `===== ${section.title} =====`, section.content)
          break
      }
    }

    return parts.join('\n')
  }

  /**
   * 构建为结构化数据（用于工具或子图传递）
   */
  buildStructured(): {
    system?: string
    context: MindmapContextData
    metadata: {
      hasWorkspace: boolean
      hasMindmap: boolean
      selectedNodeCount: number
    }
  } {
    const systemSection = this.sections.find((s) => s.type === 'system')

    return {
      system: systemSection?.type === 'system' ? systemSection.content : undefined,
      context: this.context ?? {},
      metadata: {
        hasWorkspace: !!this.context?.workspacePath,
        hasMindmap: !!(this.context?.hasDocumentOpen || this.context?.mindmapSummary),
        selectedNodeCount: this.context?.selectedNodes?.length ?? 0,
      },
    }
  }

  /**
   * 构建为消息数组（用于 LLM 调用）
   */
  buildMessages(): Array<{ role: 'system' | 'user'; content: string }> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = []

    // 第一个 system section 作为 system message
    const systemSection = this.sections.find((s) => s.type === 'system')
    if (systemSection?.type === 'system') {
      messages.push({ role: 'system', content: systemSection.content })
    }

    // 其他 sections 合并为 context message
    const contextSections = this.sections.filter((s) => s.type !== 'system')
    if (contextSections.length > 0) {
      const contextParts: string[] = []
      for (const section of contextSections) {
        switch (section.type) {
          case 'userProfile':
            contextParts.push('用户画像：', section.profileText)
            break
          case 'workspace':
            contextParts.push(`工作区: ${section.path} (${section.files.length} 个文件)`)
            break
          case 'mindmap':
            contextParts.push('思维导图已打开')
            break
          case 'selectedNodes':
            contextParts.push(`选中节点: ${section.nodes.length} 个`)
            break
          case 'custom':
            contextParts.push(`${section.title}: ${section.content}`)
            break
        }
      }
      messages.push({ role: 'user', content: `【上下文】\n${contextParts.join('\n')}` })
    }

    return messages
  }
}

/**
 * 格式化节点为上下文文本
 */
function formatNodeForContext(n: ContextNodeInfo): string {
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
}

/**
 * 预设的上下文模板
 */
export const ContextTemplates = {
  /**
   * Supervisor Agent 完整上下文
   */
  supervisor(context: MindmapContextData | null | undefined, profileText: string): ContextBuilder {
    return new ContextBuilder(context)
      .addSystem(`你是 MindLane 的 AI 助手，帮助用户进行思维导图创作、知识管理和记忆训练。

你的能力（你可以直接完成这些操作，不需要用户手动操作）：
1. 直接在画布上生成思维导图：你输出特定标记后，系统会自动将思维导图节点渲染到用户当前的画布上
2. 直接生成记忆宫殿：使用记忆宫殿法帮助用户记忆知识点，生成包含场景图和站点的 palace 节点
3. 检索用户导入的知识库文档，回答相关问题
4. 感知用户当前正在编辑的思维导图内容和选中的节点
5. 查看当前工作区中的文件列表

核心原则：
- 你拥有用户的个人知识库，里面存储了用户导入的各种文档资料。
- 关于当前状态的问题（工作区文件、打开的文件、选中的节点等），直接从"当前状态"部分回答，不需要调用任何工具。
- 如果搜索后确实没有相关结果，再如实告知用户知识库中暂无相关内容。
- 回答问题时请简洁专业，使用中文。`)
      .addUserProfile(profileText)
      .addWorkspace()
      .addMindmap()
      .addSelectedNodes()
  },

  /**
   * MindmapGen Agent 上下文（专注文档生成）
   */
  mindmapGen(context: MindmapContextData | null | undefined): ContextBuilder {
    return new ContextBuilder(context).addSystem(
      '你是思维导图生成专家。分析用户提供的文本，提取层级结构，生成清晰的思维导图。' +
        '如果用户已打开思维导图，请考虑将其作为上下文来补充内容。',
    )
  },

  /**
   * Palace Agent 上下文（专注记忆宫殿）
   */
  palace(context: MindmapContextData | null | undefined): ContextBuilder {
    return new ContextBuilder(context)
      .addSystem(
        '你是记忆宫殿设计专家。帮助用户将知识转化为记忆宫殿，包括：' +
          '1. 分析知识点，提取需要记忆的关键内容\n' +
          '2. 设计记忆路线和站点\n' +
          '3. 创建生动的视觉场景描述',
      )
      .addSelectedNodes()
  },

  /**
   * 极简上下文（用于简单问答）
   */
  minimal(context: MindmapContextData | null | undefined): ContextBuilder {
    return new ContextBuilder(context).addSystem(
      '你是 MindLane 助手。当前上下文中包含用户的工作区和思维导图信息，请据此回答。',
    )
  },
}
