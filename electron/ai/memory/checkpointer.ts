import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import path from 'node:path'
import fs from 'node:fs'

export class CheckpointerManager {
  private saver: SqliteSaver | null = null

  async init(userDataPath: string): Promise<void> {
    const dir = path.join(userDataPath, 'memory')
    await fs.promises.mkdir(dir, { recursive: true })

    const dbPath = path.join(dir, 'checkpoints.db')
    this.saver = SqliteSaver.fromConnString(dbPath)
  }

  get(): SqliteSaver | null {
    return this.saver
  }

  getAdapter(): BaseCheckpointSaver | undefined {
    return this.saver ?? undefined
  }
}
