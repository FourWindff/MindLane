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
  /**
   * **Total input** token budget (capacity) allowed for a single model call.
   * When not given explicitly it is derived from the model context window:
   * window − output reserve − estimation-error buffer.
   */
  inputBudgetTokens: number
  /**
   * Compaction trigger threshold (policy value). The trigger point is the
   * smaller of this and the capacity: small-window models trigger at their
   * capacity, large-window models keep a fixed summarization and
   * memory-extraction cadence.
   */
  consolidationTriggerTokens: number
  /** Share of capacity targeted for archiving */
  consolidationRatio: number
  /** Maximum number of messages */
  maxContextMessages: number
  maxMessagesBeforeTokenCheck: number
  maxConsolidationRounds: number
}

interface GetMessagesForContextOptions {
  /** Maximum number of messages returned (excluding system messages) */
  maxMessages?: number
}

/**
 * Session context compactor.
 *
 * Rolls the old messages after the cursor (`lastConsolidated`) in
 * `session.jsonl` into a rolling summary within the prompt token budget: each
 * round an LLM merges "previous rolling summary + new slice" into one cumulative
 * summary, written to the session meta's `_lastSummary`, and the cursor
 * advances. The summary is read by the contextCompact node into
 * `state.summary` and injected into the real model call through the
 * `## History summary` section of the system prompt — archived messages are
 * therefore replaced by the summary rather than silently truncated.
 *
 * When LLM summarization fails the cursor does not advance (the next run
 * self-heals and retries) and the current round falls back to budget trimming
 * in `getMessagesForContext`, so model calls keep working.
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
      // Capacity is derived from the model window on the fly: the output reserve and the
      // estimation buffer are both fixed deductions.
      inputBudgetTokens:
        limits?.inputBudgetTokens ??
        deps.provider.contextWindow -
          AGENT_LIMITS.maxCompletionTokens -
          AGENT_LIMITS.consolidationSafetyBuffer,
      consolidationTriggerTokens:
        limits?.consolidationTriggerTokens ?? AGENT_LIMITS.consolidationTriggerTokens,
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
   * Decide within the token budget whether to compact, and do it.
   *
   * @returns Whether compaction happened (whether the cursor advanced).
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

      // Fast path: skip when there are few unarchived messages and no tool definitions.
      if (
        unarchived.length <= limits.maxMessagesBeforeTokenCheck &&
        this.getToolDefinitions().length === 0
      ) {
        return false
      }

      const inputBudget = limits.inputBudgetTokens
      // Capacity and policy are two different things: how much fits is decided by the model
      // window, when to summarize by cost and memory cadence.
      const trigger = Math.min(limits.consolidationTriggerTokens, inputBudget)
      const target = Math.floor(inputBudget * limits.consolidationRatio)

      let currentLast = lastConsolidated
      let currentSummary = meta?._lastSummary
      let changed = false
      const archivedSlices: BaseMessage[] = []

      for (let round = 0; round < limits.maxConsolidationRounds; round++) {
        const remaining = allMessages.slice(currentLast)
        if (remaining.length === 0) break

        const estimated = await this.estimateSessionPromptTokens(remaining, currentSummary)
        if (estimated <= trigger) break

        const tokensToRemove = Math.max(0, estimated - target)
        const boundaryIdx = this.pickConsolidationBoundary(remaining, tokensToRemove)
        if (boundaryIdx < 0 || boundaryIdx >= remaining.length - 1) break

        const messagesToArchive = remaining.slice(0, boundaryIdx + 1)
        try {
          currentSummary = await this.summarize(messagesToArchive, currentSummary)
          const remainingAfter = allMessages.slice(currentLast + boundaryIdx + 1)
          log.info(
            'compact: archived %d messages (%d remaining), estimated tokens ~%d → target ~%d, summarizer=%s',
            messagesToArchive.length,
            remainingAfter.length,
            estimated,
            target,
            this.summarizerModel(),
          )
          log.debug('compact rolling summary (full text):\n%s', currentSummary)
        } catch (err) {
          // Summary failed: do not advance the cursor. This round falls back to budget
          // trimming in getMessagesForContext and the next run retries the same slice
          // (self-healing). Failed slices never reach onArchived, so no evidence is lost.
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
   * Read the uncompressed messages from `session.jsonl`, trim them by message count and token
   * budget, and return them.
   */
  async getMessagesForContext(
    sessionId: string,
    options?: GetMessagesForContextOptions,
  ): Promise<BaseMessage[]> {
    const meta = this.sessionManager.getSessionMeta(sessionId)
    const allMessages = await this.sessionManager.loadMessages(sessionId)
    const lastConsolidated = meta?.lastConsolidated ?? 0

    const maxMessages = options?.maxMessages ?? this.limits.maxContextMessages
    const budget = this.limits.inputBudgetTokens

    const candidate = allMessages.slice(lastConsolidated)

    // System messages are always kept, except for the fallback trim when the budget is exceeded.
    const systemMessages = candidate.filter((m) => m.getType() === 'system')
    const nonSystem = candidate.filter((m) => m.getType() !== 'system')

    // Always keep the current user message (the last human message).
    const currentUserMsg =
      nonSystem.length > 0 && nonSystem[nonSystem.length - 1].getType() === 'human'
        ? nonSystem[nonSystem.length - 1]
        : null
    let history = currentUserMsg ? nonSystem.slice(0, nonSystem.length - 1) : nonSystem

    // Message-count limit: keep the most recent maxMessages non-system messages (including the
    // current user message).
    const historyLimit = maxMessages - (currentUserMsg ? 1 : 0)
    if (history.length > historyLimit) {
      history = history.slice(-historyLimit)
    }

    // Trim history oldest-first until the total token count fits the budget.
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

    // Fallback: if history is empty but system messages + current user still exceed the budget,
    // trim the oldest system message.
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
   * Pick the end of the compaction chunk at a `user` message boundary.
   *
   * @returns Inclusive end index of the compaction chunk, or -1 when no suitable boundary exists.
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

    // No user boundary satisfies the token requirement: fall back to the last user boundary.
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
   * Rolling-summary input stripping: before archived messages are handed to the summarization
   * call, drop a trailing `<EDITOR_STATE>` block so a stale node list does not leak into the
   * `## History summary` section that is re-injected every round.
   * Reuses the single strip implementation from the shared contract; only human messages are
   * handled (the block only appears at the end of user messages).
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
   * Rolling summary: merge "existing summary + new slice" into one cumulative summary.
   * No standalone file is written — the result only lands in the session meta's `_lastSummary`.
   */
  private async summarize(
    messages: BaseMessage[],
    previousSummary: string | undefined,
  ): Promise<string> {
    const summaryPrompt = new SystemMessage(
      "Maintain a rolling summary of the conversation in English. Keep: 1) the user's main goals, 2) key facts and constraints, 3) recent tasks still to be done, 4) high-level conclusions about important files, nodes, or tool results. Keep it short and concrete.",
    )

    const inputs: BaseMessage[] = [summaryPrompt]
    if (previousSummary) {
      inputs.push(new SystemMessage(`Existing summary:\n${previousSummary}`))
    }
    inputs.push(...this.stripTurnStateFromMessages(messages))
    inputs.push(
      new HumanMessage(
        previousSummary
          ? 'Merge the new conversation above into the existing summary and output the updated full summary.'
          : 'Summarize the conversation above.',
      ),
    )

    const response = await this.provider.model.invoke(inputs)
    return extractTextContent(response.content)
  }
}
