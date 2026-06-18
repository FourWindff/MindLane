import fs from 'node:fs'
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { AGENT_LIMITS } from '../config.js'
import { atomicWrite } from '../../fs/atomicWrite.js'
import { logger } from '../../shared/logger.js'
import {
  estimateMessageTokens,
} from '../lib/tokenCounter.js'
import type { LLMProvider } from '../providers/index.js'
import { estimateToolsSchemaTokens } from '../memory/contextCompact.js'
import { extractTextContent, messageContentToString } from '../utils.js'
import { SessionManager } from './sessionManager.js'

interface ConsolidatorDependencies {
  sessionManager: SessionManager
  provider: LLMProvider
  buildMessages: (
    messages: BaseMessage[],
    lastSummary?: string,
  ) => Promise<BaseMessage[]>
  getToolDefinitions: () => StructuredToolInterface[]
}

interface ConsolidationLimits {
  contextWindowTokens: number
  maxCompletionTokens: number
  safetyBuffer: number
  consolidationRatio: number
  maxContextMessages: number
  maxMessagesBeforeTokenCheck: number
  maxConsolidationRounds: number
}

interface GetMessagesForContextOptions {
  /** 最大返回消息条数（不含系统消息） */
  maxMessages?: number
  /** 消息总 token 预算 */
  budget?: number
}

interface HistoryRecord {
  timestamp: string
  summary: string
}

/**
 * 会话历史归档器。
 *
 * 负责将 `session.jsonl` 中的旧消息按 prompt token 预算压缩、摘要并写入
 * `{sessionId}.history.jsonl`，维护 `lastConsolidated` 游标，并把摘要注入
 * 系统提示词。
 */
export class Consolidator {
  private readonly sessionManager: SessionManager
  private readonly provider: LLMProvider
  private readonly buildMessages: ConsolidatorDependencies['buildMessages']
  private readonly getToolDefinitions: ConsolidatorDependencies['getToolDefinitions']
  private readonly limits: ConsolidationLimits
  private static readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    deps: ConsolidatorDependencies,
    limits?: Partial<ConsolidationLimits>,
  ) {
    this.sessionManager = deps.sessionManager
    this.provider = deps.provider
    this.buildMessages = deps.buildMessages
    this.getToolDefinitions = deps.getToolDefinitions
    this.limits = {
      contextWindowTokens:
        limits?.contextWindowTokens ?? AGENT_LIMITS.contextWindowTokens,
      maxCompletionTokens:
        limits?.maxCompletionTokens ?? AGENT_LIMITS.maxCompletionTokens,
      safetyBuffer:
        limits?.safetyBuffer ?? AGENT_LIMITS.consolidationSafetyBuffer,
      consolidationRatio:
        limits?.consolidationRatio ?? AGENT_LIMITS.consolidationRatio,
      maxContextMessages:
        limits?.maxContextMessages ?? AGENT_LIMITS.maxContextMessages,
      maxMessagesBeforeTokenCheck:
        limits?.maxMessagesBeforeTokenCheck ??
        AGENT_LIMITS.maxMessagesBeforeTokenCheck,
      maxConsolidationRounds:
        limits?.maxConsolidationRounds ?? AGENT_LIMITS.maxConsolidationRounds,
    }
  }

  /**
   * 获取指定会话的异步锁，保证同一会话串行执行。
   */
  getLock(sessionId: string): Promise<void> {
    return (Consolidator.locks.get(sessionId) as Promise<void> | undefined) ?? Promise.resolve()
  }

  private async withSessionLock<T>(
    sessionId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = Consolidator.locks.get(sessionId) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(() => fn())
    Consolidator.locks.set(sessionId, current)
    try {
      return await current
    } finally {
      if (Consolidator.locks.get(sessionId) === current) {
        Consolidator.locks.delete(sessionId)
      }
    }
  }

  /**
   * 按 token 预算判断并执行归档。
   *
   * @returns 是否发生了归档。
   */
  async maybe_consolidate_by_tokens(
    sessionId: string,
    options?: Partial<ConsolidationLimits>,
  ): Promise<boolean> {
    const limits = { ...this.limits, ...options }

    return this.withSessionLock(sessionId, async () => {
      const meta = this.sessionManager.getSessionMeta(sessionId)
      const allMessages = await this.sessionManager.loadMessages(sessionId)
      const lastConsolidated = meta?.lastConsolidated ?? 0
      const unarchived = allMessages.slice(lastConsolidated)

      // 快速过滤：未归档消息数量较少且无工具定义时直接跳过。
      if (
        unarchived.length <= limits.maxMessagesBeforeTokenCheck &&
        this.getToolDefinitions().length === 0
      ) {
        return false
      }

      const inputBudget =
        limits.contextWindowTokens -
        limits.maxCompletionTokens -
        limits.safetyBuffer
      const target = Math.floor(inputBudget * limits.consolidationRatio)

      let currentLast = lastConsolidated
      let currentSummary = meta?._lastSummary
      let changed = false

      for (let round = 0; round < limits.maxConsolidationRounds; round++) {
        const remaining = allMessages.slice(currentLast)
        if (remaining.length === 0) break

        const estimated = await this.estimateSessionPromptTokens(
          remaining,
          currentSummary,
        )
        if (estimated <= inputBudget) break

        const tokensToRemove = Math.max(0, estimated - target)
        const boundaryIdx = this.pickConsolidationBoundary(
          remaining,
          tokensToRemove,
        )
        if (boundaryIdx < 0 || boundaryIdx >= remaining.length - 1) break

        const messagesToArchive = remaining.slice(0, boundaryIdx + 1)
        try {
          currentSummary = await this.archive(messagesToArchive, sessionId)
        } catch (err) {
          logger.warn(
            '[Consolidator] LLM summary failed, falling back to raw archive for session %s:',
            sessionId,
            err,
          )
          await this.rawArchive(messagesToArchive, sessionId)
        }

        currentLast += boundaryIdx + 1
        changed = true

        if (allMessages.slice(currentLast).length <= limits.maxMessagesBeforeTokenCheck) {
          break
        }
      }

      if (changed && meta) {
        await this.sessionManager.updateSessionMeta(sessionId, {
          ...meta,
          lastConsolidated: currentLast,
          _lastSummary: currentSummary ?? meta._lastSummary,
        })
      }

      return changed
    })
  }

  /**
   * 从 `session.jsonl` 读取未归档消息，按条数与 token 预算裁剪后返回。
   */
  async getMessagesForContext(
    sessionId: string,
    options?: GetMessagesForContextOptions,
  ): Promise<BaseMessage[]> {
    const meta = this.sessionManager.getSessionMeta(sessionId)
    const allMessages = await this.sessionManager.loadMessages(sessionId)
    const lastConsolidated = meta?.lastConsolidated ?? 0

    const maxMessages =
      options?.maxMessages ?? this.limits.maxContextMessages
    const budget =
      options?.budget ??
      this.limits.contextWindowTokens -
        this.limits.maxCompletionTokens -
        this.limits.safetyBuffer

    const candidate = allMessages.slice(lastConsolidated)

    // 系统消息始终保留，除非预算超限时的兜底裁剪。
    const systemMessages = candidate.filter((m) => m.getType() === 'system')
    const nonSystem = candidate.filter((m) => m.getType() !== 'system')

    // 始终保留当前用户消息（最后一条 human）。
    const currentUserMsg =
      nonSystem.length > 0 &&
      nonSystem[nonSystem.length - 1].getType() === 'human'
        ? nonSystem[nonSystem.length - 1]
        : null
    let history = currentUserMsg
      ? nonSystem.slice(0, nonSystem.length - 1)
      : nonSystem

    // 条数限制：保留最近的 maxMessages 条非系统消息（含当前用户消息）。
    const historyLimit = maxMessages - (currentUserMsg ? 1 : 0)
    if (history.length > historyLimit) {
      history = history.slice(-historyLimit)
    }

    // 从旧到新裁剪历史消息，直到总 token 在预算内。
    while (
      estimateMessageTokens([
        ...systemMessages,
        ...history,
        ...(currentUserMsg ? [currentUserMsg] : []),
      ]) > budget &&
      history.length > 0
    ) {
      history.shift()
    }

    // 兜底：若历史已清空但系统消息+当前用户仍超预算，裁剪最旧的系统消息。
    while (
      estimateMessageTokens([
        ...systemMessages,
        ...(currentUserMsg ? [currentUserMsg] : []),
      ]) > budget &&
      systemMessages.length > 1
    ) {
      systemMessages.shift()
    }

    return [
      ...systemMessages,
      ...history,
      ...(currentUserMsg ? [currentUserMsg] : []),
    ]
  }

  /**
   * 在 `user` 消息边界选择归档终点。
   *
   * @returns 归档 chunk 的结束索引（包含），-1 表示无合适边界。
   */
  pickConsolidationBoundary(
    messages: BaseMessage[],
    tokensToRemove: number,
  ): number {
    let accumulated = 0
    let lastUserIdx = -1

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      accumulated += estimateMessageTokens([msg])

      if (msg.getType() === 'human') {
        lastUserIdx = i
        if (accumulated >= tokensToRemove) {
          return i
        }
      }
    }

    // 无满足 token 要求的 user 边界时，回退到最后一个 user 边界。
    return lastUserIdx
  }

  private async estimateSessionPromptTokens(
    messages: BaseMessage[],
    lastSummary?: string,
  ): Promise<number> {
    const fullMessages = await this.buildMessages(messages, lastSummary)
    const tools = this.getToolDefinitions()
    const messageTokens = estimateMessageTokens(fullMessages)
    const toolTokens = estimateToolsSchemaTokens(tools)
    return messageTokens + toolTokens
  }

  private async archive(
    messages: BaseMessage[],
    sessionId: string,
  ): Promise<string> {
    const summaryPrompt = new SystemMessage(
      '请用中文简要总结以下对话的关键信息。保留：1）用户的主要目标，2）关键事实和约束，3）最近待继续执行的任务，4）重要文件、节点或工具结果的高层结论。保持简短具体。',
    )

    const response = await this.provider.reasoningModel.invoke([
      summaryPrompt,
      ...messages,
      new HumanMessage('请总结以上对话。'),
    ])

    const summary = extractTextContent(response.content)
    await this.appendHistoryRecord(sessionId, {
      timestamp: new Date().toISOString(),
      summary,
    })
    return summary
  }

  private async rawArchive(
    messages: BaseMessage[],
    sessionId: string,
  ): Promise<void> {
    const rawText = messages
      .map(
        (m) =>
          `[${m.getType()}]: ${messageContentToString(m.content)}`,
      )
      .join('\n')

    await this.appendHistoryRecord(sessionId, {
      timestamp: new Date().toISOString(),
      summary: `[RAW]\n${rawText}`,
    })
  }

  private async appendHistoryRecord(
    sessionId: string,
    record: HistoryRecord,
  ): Promise<void> {
    const records = this.readHistoryRecords(sessionId)
    records.push(record)

    const createdAt =
      records[0]?.timestamp ?? new Date().toISOString()
    const meta = {
      sessionId,
      createdAt,
      updatedAt: new Date().toISOString(),
    }

    const lines = [
      JSON.stringify(meta),
      ...records.map((r) => JSON.stringify(r)),
    ]

    const historyPath = this.sessionManager.resolveHistoryPath(sessionId)
    await atomicWrite(historyPath, lines.join('\n') + '\n')
  }

  private readHistoryRecords(sessionId: string): HistoryRecord[] {
    const historyPath = this.sessionManager.resolveHistoryPath(sessionId)
    if (!fs.existsSync(historyPath)) return []

    const content = fs.readFileSync(historyPath, 'utf-8')
    if (!content) return []

    const lines = content.split(/\r?\n/)
    const result: HistoryRecord[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      try {
        const parsed = JSON.parse(line) as HistoryRecord & { sessionId?: string }
        // 首行是元数据（含 sessionId），其余为历史摘要记录。
        if (parsed.summary && !parsed.sessionId) {
          result.push(parsed)
        }
      } catch {
        // 跳过损坏行
      }
    }
    return result
  }
}
