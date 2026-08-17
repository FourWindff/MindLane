import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from '../../fs/atomicWrite.js'

/**
 * Single-file memory store: `MEMORY.md` under `userData/mindlanememory`.
 * One line = one fact about the user (thinking style, preferences, habits).
 * The file is always the current, LLM-organized fact set — extraction reads it,
 * merges new evidence, and rewrites it wholesale.
 */
export class MemoryManager {
  private dir: string
  private indexPath: string

  constructor(userDataPath: string) {
    this.dir = path.join(userDataPath, 'mindlanememory')
    this.indexPath = path.join(this.dir, 'MEMORY.md')
  }

  async loadMemory(): Promise<string> {
    try {
      return await fs.promises.readFile(this.indexPath, 'utf-8')
    } catch {
      return ''
    }
  }

  async writeMemory(content: string): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true })
    await atomicWrite(this.indexPath, content.endsWith('\n') ? content : `${content}\n`)
  }
}
