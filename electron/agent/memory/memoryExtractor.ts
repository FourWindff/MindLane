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
        const role = m.getType() === 'human' ? 'User' : 'AI'
        // Extraction-evidence stripping: drop the trailing `<EDITOR_STATE>` block
        // from user messages so XML state noise does not pollute memory
        // consolidation. Reuses the single strip implementation from the shared contract.
        const text = stripTurnState(messageContentToString(m.content))
        return `${role}: ${text}`
      })
      .join('\n')

    const editlog =
      editlogEntries.length > 0
        ? editlogEntries.map((e) => `Node ${e.nodeId}: "${e.before}" → "${e.after}"`).join('\n')
        : '(none)'

    const existingFacts = existing.trim() || '(none yet)'

    return `You are the curator of the user's cognitive profile. You maintain a MEMORY.md that records the user's ways of thinking, preferences, and habits, one fact per line.

Task:
1. Read the "Existing MEMORY.md" and the "New evidence" below (conversation content + node edit history).
2. Add the new facts distilled from the new evidence to the list; merge and deduplicate entries that clearly repeat or are close to existing facts.
3. Output the full consolidated fact list (the entire list, not a delta).

Rules:
- One fact per line; complete, concise, standalone sentences (e.g. "The user prefers splitting problems into independent modules").
- No categories, no tags, no quoting the evidence verbatim.
- Keep every existing fact as is, except for clear duplicates/close entries that need merging; do not omit them or reword their meaning.
- Output JSON only, no other text: {"facts": ["fact one", "fact two", ...]}
- When there are no new facts and the existing facts are empty, return {"facts": []}

Existing MEMORY.md:
${existingFacts}

New evidence:
Conversation:
${conversation}

Node edit history (before/after of node text the user edited by hand):
${editlog}

Output the full consolidated fact list.`
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
