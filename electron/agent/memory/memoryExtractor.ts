import { SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { LLMProvider } from '../providers/index.js'
import { MemoryManager } from './memoryManager.js'
import type { EditLogEntry, EditLogStore } from './editLogStore.js'
import { logger } from '../../shared/logger.js'
import { messageContentToString } from '../utils.js'
import { stripTurnState } from '../../ipc.js'

interface ExtractOptions {
  provider: LLMProvider
  /** Archived message slice supplied by the caller (the extraction cursor rides on `lastConsolidated`). */
  messages: BaseMessage[]
  /** Node edit history for the current fileUuid (may be empty). */
  editlogEntries: EditLogEntry[]
}

export class MemoryExtractor {
  constructor(private manager: MemoryManager) {}

  /**
   * Merge the archived evidence slice into `MEMORY.md`:
   * read current facts, ask the LLM to consolidate them with the new evidence,
   * and rewrite the file wholesale. A failed/empty LLM result keeps the old file.
   */
  async extractAndPersist(options: ExtractOptions): Promise<void> {
    const { provider, messages, editlogEntries } = options
    logger.withContext('memory').debug('Starting extraction')
    const existing = await this.manager.loadMemory()
    const facts = await this.extract(provider, messages, editlogEntries, existing)
    if (facts.length === 0) {
      logger.withContext('memory').debug('No facts extracted, keeping existing memory')
      return
    }
    await this.manager.writeMemory(facts.join('\n'))
    logger.withContext('memory').debug(`Merged ${facts.length} fact(s) into MEMORY.md`)
  }

  /** Call LLM to merge existing facts with the new evidence into a full fact list. */
  private async extract(
    provider: LLMProvider,
    messages: BaseMessage[],
    editlogEntries: EditLogEntry[],
    existing: string,
  ): Promise<string[]> {
    const prompt = this.buildExtractionPrompt(messages, editlogEntries, existing)
    const response = await provider.model.invoke([new SystemMessage(prompt)])
    return this.parseExtractionResponse(response.content)
  }

  private buildExtractionPrompt(
    messages: BaseMessage[],
    editlogEntries: EditLogEntry[],
    existing: string,
  ): string {
    const conversation = messages
      .filter((m) => m.getType() === 'human' || m.getType() === 'ai')
      .map((m) => {
        const role = m.getType() === 'human' ? '用户' : 'AI'
        // 提取证据剥离：去掉用户消息末尾的 `<EDITOR_STATE>` 块，
        // 避免 XML 状态噪声混入记忆整理。复用共享契约的单一 strip 实现。
        const text = stripTurnState(messageContentToString(m.content))
        return `${role}: ${text}`
      })
      .join('\n')

    const editlog =
      editlogEntries.length > 0
        ? editlogEntries.map((e) => `节点 ${e.nodeId}: 「${e.before}」→「${e.after}」`).join('\n')
        : '（无）'

    const existingFacts = existing.trim() || '（暂无）'

    return `你是用户的认知档案管理员。维护一份 MEMORY.md，记录用户的思维方式、偏好与习惯，一行一条事实。

任务：
1. 阅读下方「现有 MEMORY.md」与「新证据」（对话内容 + 节点编辑历史）。
2. 把新证据中沉淀出的新事实加入清单；对与现有事实明显重复或相近的条目进行合并去重。
3. 输出整理后的完整事实清单（全量，不是增量）。

规则：
- 一行一条事实，语句完整、简洁、独立成句（如「用户偏好将问题拆分为独立模块」）。
- 不分类、不打标签、不写证据原文。
- 除明显重复/相近需合并外，现有事实一律保留，不要遗漏或改写原意。
- 只输出 JSON，不要其他文本：{"facts": ["事实一", "事实二", ...]}
- 没有新事实且现有事实为空时返回 {"facts": []}

现有 MEMORY.md：
${existingFacts}

新证据：
对话内容：
${conversation}

节点编辑历史（用户手动修改节点文本的前后对比）：
${editlog}

请输出整理后的完整事实清单。`
  }

  private parseExtractionResponse(content: unknown): string[] {
    const text = typeof content === 'string' ? content : JSON.stringify(content)

    const jsonText = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    try {
      const parsed = JSON.parse(jsonText) as { facts?: unknown }
      const raw = parsed.facts ?? []
      if (!Array.isArray(raw)) return []
      return raw.map((f) => String(f).replace(/\s+/g, ' ').trim()).filter((f) => f.length > 0)
    } catch (e) {
      logger
        .withContext('memory')
        .warn('Failed to parse LLM response:', e, 'raw:', text.slice(0, 500))
      return []
    }
  }
}

/**
 * Build the Consolidator `onArchived` callback: reads the file's editlog,
 * runs extraction on the archived slice, and deletes the editlog only after
 * a successful extraction (kept on failure so evidence is not lost).
 */
export function createExtractionCallback(deps: {
  extractor: MemoryExtractor
  editLogStore: EditLogStore
  provider: LLMProvider
  workspaceUuid: string
  fileUuid: string
}): (messages: BaseMessage[]) => Promise<void> {
  return async (messages) => {
    const editlogEntries = await deps.editLogStore.read(deps.workspaceUuid, deps.fileUuid)
    await deps.extractor.extractAndPersist({
      provider: deps.provider,
      messages,
      editlogEntries,
    })
    if (editlogEntries.length > 0) {
      await deps.editLogStore.delete(deps.workspaceUuid, deps.fileUuid)
    }
  }
}
