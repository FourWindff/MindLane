import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { AGENT_LIMITS } from '../config.js'
import { logger } from '../../shared/logger.js'
import { estimateMessageTokens } from '../lib/tokenCounter.js'
import type { LLMProvider } from '../providers/index.js'
import { estimateToolsSchemaTokens } from '../memory/contextCompact.js'
import { extractTextContent } from '../utils.js'
import { stripTurnState } from '../../ipc.js'
import { SessionManager } from './sessionManager.js'

const log = logger.withContext('consolidator')

interface ConsolidatorDependencies {
  sessionManager: SessionManager
  provider: LLMProvider
  buildMessages: (messages: BaseMessage[], lastSummary?: string) => Promise<BaseMessage[]>
  getToolDefinitions: () => StructuredToolInterface[]
  /**
   * Optional memory-extraction hook. Fired fire-and-forget after a compression
   * round with the archived message slice; rejections are swallowed and
   * logged, never affecting compression.
   */
  onArchived?: (archived: BaseMessage[]) => void | Promise<void>
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

/**
 * 会话上下文压缩器。
 *
 * 负责按 prompt token 预算将 `session.jsonl` 中游标（`lastConsolidated`）之后的
 * 旧消息滚动摘要：每轮用 LLM 把「上一轮滚动摘要 + 新切片」合并为一份累积摘要，
 * 写入会话 meta 的 `_lastSummary` 并推进游标。摘要由 contextCompact 节点读入
 * `state.summary`，经 system prompt 的 `## 历史摘要` 段注入实际模型调用——
 * 归档的消息因此被摘要替代，而不是静默截断。
 *
 * LLM 摘要失败时不推进游标（下轮 run 自愈重试），本轮由 `getMessagesForContext`
 * 按预算裁剪兜底，保证模型调用继续。
 */
export class Consolidator {
  private readonly sessionManager: SessionManager
  private readonly provider: LLMProvider
  private readonly buildMessages: ConsolidatorDependencies['buildMessages']
  private readonly getToolDefinitions: ConsolidatorDependencies['getToolDefinitions']
  private readonly onArchived: ConsolidatorDependencies['onArchived']
  private readonly limits: ConsolidationLimits
  private static readonly locks = new Map<string, Promise<unknown>>()

  constructor(deps: ConsolidatorDependencies, limits?: Partial<ConsolidationLimits>) {
    this.sessionManager = deps.sessionManager
    this.provider = deps.provider
    this.buildMessages = deps.buildMessages
    this.getToolDefinitions = deps.getToolDefinitions
    this.onArchived = deps.onArchived
    this.limits = {
      contextWindowTokens: limits?.contextWindowTokens ?? AGENT_LIMITS.contextWindowTokens,
      maxCompletionTokens: limits?.maxCompletionTokens ?? AGENT_LIMITS.maxCompletionTokens,
      safetyBuffer: limits?.safetyBuffer ?? AGENT_LIMITS.consolidationSafetyBuffer,
      consolidationRatio: limits?.consolidationRatio ?? AGENT_LIMITS.consolidationRatio,
      maxContextMessages: limits?.maxContextMessages ?? AGENT_LIMITS.maxContextMessages,
      maxMessagesBeforeTokenCheck:
        limits?.maxMessagesBeforeTokenCheck ?? AGENT_LIMITS.maxMessagesBeforeTokenCheck,
      maxConsolidationRounds: limits?.maxConsolidationRounds ?? AGENT_LIMITS.maxConsolidationRounds,
    }
  }

  private async withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
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
   * 按 token 预算判断并执行压缩。
   *
   * @returns 是否发生了压缩（游标是否推进）。
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
        limits.contextWindowTokens - limits.maxCompletionTokens - limits.safetyBuffer
      const target = Math.floor(inputBudget * limits.consolidationRatio)

      let currentLast = lastConsolidated
      let currentSummary = meta?._lastSummary
      let changed = false
      const archivedSlices: BaseMessage[] = []

      for (let round = 0; round < limits.maxConsolidationRounds; round++) {
        const remaining = allMessages.slice(currentLast)
        if (remaining.length === 0) break

        const estimated = await this.estimateSessionPromptTokens(remaining, currentSummary)
        if (estimated <= inputBudget) break

        const tokensToRemove = Math.max(0, estimated - target)
        const boundaryIdx = this.pickConsolidationBoundary(remaining, tokensToRemove)
        if (boundaryIdx < 0 || boundaryIdx >= remaining.length - 1) break

        const messagesToArchive = remaining.slice(0, boundaryIdx + 1)
        try {
          currentSummary = await this.summarize(messagesToArchive, currentSummary)
          const remainingAfter = allMessages.slice(currentLast + boundaryIdx + 1)
          log.info(
            'compact: 压缩 %d 条（剩余 %d 条），估算 tokens ~%d → 目标 ~%d, summarizer=%s',
            messagesToArchive.length,
            remainingAfter.length,
            estimated,
            target,
            this.summarizerModel(),
          )
          log.debug('compact 滚动摘要全文：\n%s', currentSummary)
        } catch (err) {
          // 摘要失败：不推进游标，本轮交给 getMessagesForContext 预算裁剪兜底，
          // 下轮 run 重试同一切片（自愈）。失败切片不进 onArchived，证据不丢。
          log.warn(
            'LLM summary failed for session %s, cursor not advanced (retry next run):',
            sessionId,
            err,
          )
          break
        }
        archivedSlices.push(...messagesToArchive)

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

      // Memory extraction rides on compression: the archived slice is the
      // extraction input and lastConsolidated doubles as the extraction cursor.
      // Fire-and-forget — failures are logged, never propagated.
      const onArchived = this.onArchived
      if (changed && onArchived && archivedSlices.length > 0) {
        void Promise.resolve()
          .then(() => onArchived(archivedSlices))
          .catch((err) => {
            log.warn('extraction callback failed for session %s:', sessionId, err)
          })
      }

      return changed
    })
  }

  /**
   * 从 `session.jsonl` 读取未压缩消息，按条数与 token 预算裁剪后返回。
   */
  async getMessagesForContext(
    sessionId: string,
    options?: GetMessagesForContextOptions,
  ): Promise<BaseMessage[]> {
    const meta = this.sessionManager.getSessionMeta(sessionId)
    const allMessages = await this.sessionManager.loadMessages(sessionId)
    const lastConsolidated = meta?.lastConsolidated ?? 0

    const maxMessages = options?.maxMessages ?? this.limits.maxContextMessages
    const budget =
      options?.budget ??
      this.limits.contextWindowTokens - this.limits.maxCompletionTokens - this.limits.safetyBuffer

    const candidate = allMessages.slice(lastConsolidated)

    // 系统消息始终保留，除非预算超限时的兜底裁剪。
    const systemMessages = candidate.filter((m) => m.getType() === 'system')
    const nonSystem = candidate.filter((m) => m.getType() !== 'system')

    // 始终保留当前用户消息（最后一条 human）。
    const currentUserMsg =
      nonSystem.length > 0 && nonSystem[nonSystem.length - 1].getType() === 'human'
        ? nonSystem[nonSystem.length - 1]
        : null
    let history = currentUserMsg ? nonSystem.slice(0, nonSystem.length - 1) : nonSystem

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
      estimateMessageTokens([...systemMessages, ...(currentUserMsg ? [currentUserMsg] : [])]) >
        budget &&
      systemMessages.length > 1
    ) {
      systemMessages.shift()
    }

    return [...systemMessages, ...history, ...(currentUserMsg ? [currentUserMsg] : [])]
  }

  /**
   * 在 `user` 消息边界选择压缩终点。
   *
   * @returns 压缩 chunk 的结束索引（包含），-1 表示无合适边界。
   */
  pickConsolidationBoundary(messages: BaseMessage[], tokensToRemove: number): number {
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

  private summarizerModel(): string {
    return (this.provider.model as { model?: string }).model ?? 'unknown'
  }

  /**
   * 滚动摘要输入剥离：归档消息喂给摘要调用前去掉末尾 `<EDITOR_STATE>` 块，
   * 避免过时的节点列表混入每轮重注入的 `## 历史摘要`。
   * 复用共享契约的单一 strip 实现；只处理 human 消息（块只出现在用户消息末尾）。
   */
  private stripTurnStateFromMessages(messages: BaseMessage[]): BaseMessage[] {
    return messages.map((message) => {
      if (message.getType() !== 'human') return message
      const content = message.content
      if (typeof content !== 'string') return message
      const stripped = stripTurnState(content)
      if (stripped === content) return message
      return new HumanMessage({
        content: stripped,
        additional_kwargs: message.additional_kwargs,
      })
    })
  }

  /**
   * 滚动摘要：把「已有摘要 + 新切片」合并为一份累积摘要。
   * 不写任何独立文件——结果只落在会话 meta 的 `_lastSummary`。
   */
  private async summarize(
    messages: BaseMessage[],
    previousSummary: string | undefined,
  ): Promise<string> {
    const summaryPrompt = new SystemMessage(
      '请用中文维护对话的滚动摘要。保留：1）用户的主要目标，2）关键事实和约束，3）最近待继续执行的任务，4）重要文件、节点或工具结果的高层结论。保持简短具体。',
    )

    const inputs: BaseMessage[] = [summaryPrompt]
    if (previousSummary) {
      inputs.push(new SystemMessage(`已有摘要：\n${previousSummary}`))
    }
    inputs.push(...this.stripTurnStateFromMessages(messages))
    inputs.push(
      new HumanMessage(
        previousSummary
          ? '请把以上新对话合并进已有摘要，输出更新后的完整摘要。'
          : '请总结以上对话。',
      ),
    )

    const response = await this.provider.model.invoke(inputs)
    return extractTextContent(response.content)
  }
}
