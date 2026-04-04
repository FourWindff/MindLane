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
export interface StoredMessage {
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
export interface ChatSessionMeta {
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
export class ChatHistoryManager {
  private chatHistoryDir: string

  constructor(userDataPath: string) {
    this.chatHistoryDir = path.join(userDataPath, 'chat-history')
    // 确保目录存在
    fs.mkdirSync(this.chatHistoryDir, { recursive: true })
  }

  /**
   * 获取工作区对应的聊天历史目录
   */
  private getWorkspaceChatDir(workspacePath: string): string {
    const wsId = nodeCrypto.createHash('md5').update(workspacePath).digest('hex').slice(0, 12)
    const dir = path.join(this.chatHistoryDir, wsId)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * 获取会话文件路径
   */
  private getSessionFilePath(workspacePath: string, sessionId: string): string {
    return path.join(this.getWorkspaceChatDir(workspacePath), `${sessionId}.json`)
  }

  /**
   * 获取会话元数据文件路径
   */
  private getSessionsMetaPath(workspacePath: string): string {
    return path.join(this.getWorkspaceChatDir(workspacePath), 'sessions.json')
  }

  /**
   * 加载指定会话的历史消息
   *
   * @param workspacePath 工作区路径
   * @param threadId 会话/线程 ID
   * @returns 历史消息数组，如果没有则返回空数组
   */
  async loadHistory(workspacePath: string, threadId: string): Promise<StoredMessage[]> {
    try {
      const filePath = this.getSessionFilePath(workspacePath, threadId)
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
   * @param workspacePath 工作区路径
   * @param threadId 会话/线程 ID
   * @param options 转换选项
   * @returns LangChain BaseMessage 数组
   */
  async loadHistoryAsMessages(
    workspacePath: string,
    threadId: string,
    options: {
      /** 是否包含 system 消息（默认：true） */
      includeSystem?: boolean
      /** 最大消息数量限制（默认：无限制） */
      maxMessages?: number
    } = {},
  ): Promise<BaseMessage[]> {
    const { includeSystem = true, maxMessages } = options

    const stored = await this.loadHistory(workspacePath, threadId)

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
   * @param workspacePath 工作区路径
   * @param threadId 会话/线程 ID
   * @param provider LLM 提供者（用于压缩策略）
   * @param currentUserMessage 当前用户输入（将被添加到历史末尾）
   * @returns 压缩后的消息数组，可直接用于 LLM 调用
   */
  async buildContextMessages(
    workspacePath: string,
    threadId: string,
    provider: LLMProvider,
    currentUserMessage?: string,
  ): Promise<BaseMessage[]> {
    // 1. 加载历史
    const messages = await this.loadHistoryAsMessages(workspacePath, threadId, {
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
  async listSessions(workspacePath: string): Promise<ChatSessionMeta[]> {
    try {
      const metaPath = this.getSessionsMetaPath(workspacePath)
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
    workspacePath: string,
    sessionId: string,
    messages: StoredMessage[],
  ): Promise<void> {
    const dir = this.getWorkspaceChatDir(workspacePath)
    const filePath = path.join(dir, `${sessionId}.json`)
    const now = new Date().toISOString()

    // 保存消息
    fs.writeFileSync(
      filePath,
      JSON.stringify({ messages, updatedAt: now }, null, 2),
      'utf-8',
    )

    // 更新元数据
    await this.updateSessionMeta(workspacePath, sessionId, messages, now)
  }

  /**
   * 更新会话元数据
   */
  private async updateSessionMeta(
    workspacePath: string,
    sessionId: string,
    messages: StoredMessage[],
    now: string,
  ): Promise<void> {
    const sessions = await this.listSessions(workspacePath)
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

    const sessionMeta: ChatSessionMeta = {
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

    const metaPath = this.getSessionsMetaPath(workspacePath)
    fs.writeFileSync(metaPath, JSON.stringify({ sessions }, null, 2), 'utf-8')
  }

  /**
   * 删除会话
   */
  async deleteSession(workspacePath: string, sessionId: string): Promise<void> {
    const sessions = await this.listSessions(workspacePath)
    const filtered = sessions.filter((s) => s.id !== sessionId)

    const metaPath = this.getSessionsMetaPath(workspacePath)
    fs.writeFileSync(metaPath, JSON.stringify({ sessions: filtered }, null, 2), 'utf-8')

    const filePath = this.getSessionFilePath(workspacePath, sessionId)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  /**
   * 获取最近使用的会话 ID
   */
  async getMostRecentSessionId(workspacePath: string): Promise<string | null> {
    const sessions = await this.listSessions(workspacePath)
    return sessions.length > 0 ? sessions[0].id : null
  }
}
