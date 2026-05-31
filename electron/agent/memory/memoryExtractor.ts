import { MemoryManager } from './memoryManager.js'
import type { SessionMessage } from '../db/chatDb.js'

export interface ExtractedPattern {
  discipline: string
  subTag: string
  description: string
  observation: string
}

export class MemoryExtractor {
  constructor(private manager: MemoryManager) {}

  /** Phase 1 placeholder. Phase 2: LLM-driven extraction. */
  async extractAndPersist(
    _messages: SessionMessage[],
    _mindmapSummary: string,
    _filePath: string,
  ): Promise<void> {
    // Phase 1: Manual tagging only. No automatic LLM extraction.
    // Phase 2: Build extraction prompt, invoke LLM, parse JSON, call persist().
  }

  /** Persist extracted patterns to memory files and rebuild index */
  async persist(patterns: ExtractedPattern[], userDataPath: string): Promise<void> {
    for (const p of patterns) {
      const tag = `${p.discipline}-${p.subTag}`
      await this.manager.writeMemory(tag, p.description, p.observation)
    }

    if (await this.manager.shouldConsolidate()) {
      await this.manager.consolidate()
    }
  }
}
