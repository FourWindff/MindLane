import { CheckpointerManager } from './memory/checkpointer.js'
import { UserProfileManager } from './memory/userProfile.js'

export class AiService {
  readonly checkpointer = new CheckpointerManager()
  readonly userProfile = new UserProfileManager()

  async init(userDataPath: string): Promise<void> {
    this.userProfile.init(userDataPath)
    await this.checkpointer.init(userDataPath)
  }
}
