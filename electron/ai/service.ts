import { CheckpointerManager } from './memory/checkpointer.js'
import { VectorStoreManager } from './vectorstore/store.js'
import { DocumentIndexer } from './vectorstore/indexer.js'
import { UserProfileManager } from './memory/userProfile.js'

export class AiService {
  readonly checkpointer = new CheckpointerManager()
  readonly vectorStore = new VectorStoreManager()
  readonly indexer = new DocumentIndexer(this.vectorStore)
  readonly userProfile = new UserProfileManager()

  async init(userDataPath: string, apiKey?: string, baseUrl?: string): Promise<void> {
    this.indexer.init(userDataPath)
    this.userProfile.init(userDataPath)

    await this.checkpointer.init(userDataPath)

    if (apiKey) {
      await this.vectorStore.init(userDataPath, apiKey, baseUrl)
    }
  }
}
