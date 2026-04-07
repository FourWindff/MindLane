import type { LLMProvider } from './providers/index.js'
import { CheckpointerManager } from './memory/checkpointer.js'
import { UserProfileManager } from './memory/userProfile.js'
import { RAGManager } from './rag/index.js'

export class AiService {
  readonly checkpointer = new CheckpointerManager()
  readonly userProfile = new UserProfileManager()
  readonly rag = new RAGManager()

  async init(userDataPath: string, provider?: LLMProvider): Promise<void> {
    this.userProfile.init(userDataPath)
    await this.checkpointer.init(userDataPath)
    await this.rag.init(userDataPath, provider)
  }
}
