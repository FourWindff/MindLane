import path from 'node:path'
import fs from 'node:fs'
import { CheckpointerManager } from './memory/checkpointer.js'
import { UserProfileManager } from './memory/userProfile.js'
import { SessionManager } from './context/sessionManager.js'

export class AiService {
  readonly checkpointer = new CheckpointerManager()
  readonly userProfile = new UserProfileManager()
  readonly sessionManager = new SessionManager()

  async init(userDataPath: string): Promise<void> {
    this.userProfile.init(userDataPath)

    const dbDir = path.join(userDataPath, 'memory')
    await fs.promises.mkdir(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, 'app.db')

    this.sessionManager.init(dbPath, { userDataPath })
    await this.checkpointer.initWithDbPath(dbPath)
  }
}
