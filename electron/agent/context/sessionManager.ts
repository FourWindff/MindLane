import fs from 'node:fs'
import path from 'node:path'
import nodeCrypto from 'node:crypto'
import type { BaseMessage } from '@langchain/core/messages'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { compressMessages } from '../memory/compression.js'
import type { LLMProvider } from '../providers/index.js'

/**
 * 聊天消息格式（存储用）
 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown>
    result: string
  }>
  timestamp?: string
}

/**
 * 会话元数据
 */
export interface SessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}


/**
 * 聊天历史管理器 - 负责加载和管理历史消息
 *
 * 职责：
 * 1. 从 SQLite/文件系统加载指定会话的历史消息
 * 2. 将存储格式转换为 LangChain Message 格式
 * 3. 提供消息压缩/截断策略
 * 4. 支持会话的 CRUD 操作
 */
export class SessionManager {
  private chatHistoryDir: string
  private workspacePath: string
  private workspaceChatDir: string

  constructor(userDataPath: string, workspacePath: string) {
    this.chatHistoryDir = path.join(userDataPath, 'chat-history')
    this.workspacePath = workspacePath
    this.workspaceChatDir = this.initWorkspaceChatDir()
  }

  /**
   * 初始化工作区聊天历史目录
   */
  private initWorkspaceChatDir(): string {
    const wsId = nodeCrypto.createHash('md5').update(this.workspacePath).digest('hex').slice(0, 12)
    const dir = path.join(this.chatHistoryDir, wsId)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * 获取会话文件路径
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(this.workspaceChatDir, `${sessionId}.json`)
  }

  /**
   * 获取会话元数据文件路径
   */
  private getSessionsMetaPath(): string {
    return path.join(this.workspaceChatDir, 'sessions.json')
  }

  /**
   * 切换工作区（用于复用实例）
   */
  switchWorkspace(workspacePath: string): void {
    this.workspacePath = workspacePath
    this.workspaceChatDir = this.initWorkspaceChatDir()
  }

  /**
   * 加载指定会话的历史消息
   *
   * @param threadId 会话/线程 ID
   * @returns 历史消息数组，如果没有则返回空数组
   */
  async loadHistory(threadId: string): Promise<SessionMessage[]> {
    try {
      const filePath = this.getSessionFilePath(threadId)
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        return Array.isArray(data.messages) ? data.messages : []
      }
    } catch (error) {
      console.error('Failed to load chat history:', error)
    }
    return []
  }

  /**
   * 加载指定会话的历史消息并转换为 LangChain Message 格式
   *
   * @param threadId 会话/线程 ID
   * @param options 转换选项
   * @returns LangChain BaseMessage 数组
   */
  async loadHistoryAsMessages(
    threadId: string,
    options: {
      /** 是否包含 system 消息（默认：true） */
      includeSystem?: boolean
      /** 最大消息数量限制（默认：无限制） */
      maxMessages?: number
    } = {},
  ): Promise<BaseMessage[]> {
    const { includeSystem = true, maxMessages } = options

    const stored = await this.loadHistory(threadId)

    // 转换为 LangChain Message 格式
    const messages: BaseMessage[] = []

    for (const msg of stored) {
      // 跳过 system 消息（如果需要）
      if (msg.role === 'system' && !includeSystem) continue

      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content))
      } else if (msg.role === 'assistant') {
        messages.push(new AIMessage(msg.content))
      } else if (msg.role === 'system') {
        messages.push(new SystemMessage(msg.content))
      }
    }

    // 应用消息数量限制
    if (maxMessages && messages.length > maxMessages) {
      // 保留最近的消息
      return messages.slice(-maxMessages)
    }

    return messages
  }

  /**
   * 加载并压缩历史消息，用于 LLM 上下文
   *
   * @param threadId 会话/线程 ID
   * @param provider LLM 提供者（用于压缩策略）
   * @param currentUserMessage 当前用户输入（将被添加到历史末尾）
   * @returns 压缩后的消息数组，可直接用于 LLM 调用
   */
  async buildContextMessages(
    threadId: string,
    provider: LLMProvider,
    currentUserMessage?: string,
  ): Promise<BaseMessage[]> {
    // 1. 加载历史
    const messages = await this.loadHistoryAsMessages(threadId, {
      includeSystem: false, // system 消息由 ContextBuilder 处理
    })

    // 2. 添加当前用户消息
    if (currentUserMessage) {
      messages.push(new HumanMessage(currentUserMessage))
    }

    // 3. 压缩消息（避免超出上下文窗口）
    return compressMessages(messages, provider.reasoningModel)
  }

  /**
   * 加载所有会话列表
   */
  async listSessions(): Promise<SessionMeta[]> {
    try {
      const metaPath = this.getSessionsMetaPath()
      if (fs.existsSync(metaPath)) {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        return Array.isArray(data.sessions) ? data.sessions : []
      }
    } catch (error) {
      console.error('Failed to load sessions meta:', error)
    }
    return []
  }

  /**
   * 保存会话历史
   */
  async saveSession(
    sessionId: string,
    messages: SessionMessage[],
  ): Promise<void> {
    const filePath = this.getSessionFilePath(sessionId)
    const now = new Date().toISOString()

    // 保存消息
    fs.writeFileSync(
      filePath,
      JSON.stringify({ messages, updatedAt: now }, null, 2),
      'utf-8',
    )

    // 更新元数据
    await this.updateSessionMeta(sessionId, messages, now)
  }

  /**
   * 更新会话元数据
   */
  private async updateSessionMeta(
    sessionId: string,
    messages: SessionMessage[],
    now: string,
  ): Promise<void> {
    const sessions = await this.listSessions()
    const existingIndex = sessions.findIndex((s) => s.id === sessionId)

    const firstUserMessage = messages.find((m) => m.role === 'user')
    const title = firstUserMessage
      ? firstUserMessage.content.slice(0, 30) +
        (firstUserMessage.content.length > 30 ? '...' : '')
      : `新对话 ${new Date().toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}`

    const sessionMeta: SessionMeta = {
      id: sessionId,
      title: existingIndex >= 0 ? sessions[existingIndex].title : title,
      createdAt: existingIndex >= 0 ? sessions[existingIndex].createdAt : now,
      updatedAt: now,
      messageCount: messages.length,
    }

    if (existingIndex >= 0) {
      sessions[existingIndex] = sessionMeta
    } else {
      sessions.unshift(sessionMeta)
    }

    // 按更新时间排序
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    const metaPath = this.getSessionsMetaPath()
    fs.writeFileSync(metaPath, JSON.stringify({ sessions }, null, 2), 'utf-8')
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.listSessions()
    const filtered = sessions.filter((s) => s.id !== sessionId)

    const metaPath = this.getSessionsMetaPath()
    fs.writeFileSync(metaPath, JSON.stringify({ sessions: filtered }, null, 2), 'utf-8')

    const filePath = this.getSessionFilePath(sessionId)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  /**
   * 获取最近使用的会话 ID
   */
  async getMostRecentSessionId(): Promise<string | null> {
    const sessions = await this.listSessions()
    return sessions.length > 0 ? sessions[0].id : null
  }
}
