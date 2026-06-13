import path from 'node:path'
import fs from 'node:fs'
import { CheckpointerManager } from './memory/checkpointer.js'
import { SessionManager } from './context/sessionManager.js'
import { MemoryManager } from './memory/memoryManager.js'
import { MemoryExtractor } from './memory/memoryExtractor.js'

export class AiService {
  readonly checkpointer = new CheckpointerManager()
  readonly sessionManager = new SessionManager()
  memoryManager?: MemoryManager
  memoryExtractor?: MemoryExtractor

  async init(userDataPath: string): Promise<void> {
    const dbDir = path.join(userDataPath, 'memory')
    await fs.promises.mkdir(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, 'app.db')

    await this.sessionManager.init(dbPath, { userDataPath })
    await this.checkpointer.initWithDbPath(dbPath)
    this.sessionManager.setCheckpointer(this.checkpointer)

    this.memoryManager = new MemoryManager(userDataPath)
    this.memoryExtractor = new MemoryExtractor(this.memoryManager)
  }
}
