import { MemoryManager } from './memoryManager.js'

export interface ExtractedPattern {
  discipline: string
  subTag: string
  description: string
  observation: string
}

export class MemoryExtractor {
  constructor(private manager: MemoryManager) {}

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
