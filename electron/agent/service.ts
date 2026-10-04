import path from 'node:path'
import fs from 'node:fs'
import { CheckpointerManager } from './memory/checkpointer.js'
import { SessionManager } from './context/sessionManager.js'
import { MemoryManager } from './memory/memoryManager.js'
import { MemoryExtractor } from './memory/memoryExtractor.js'
import { EditLogStore } from './memory/editLogStore.js'

/**
 * Assembly result of the agent-side services. All five are non-optional: the
 * assembly function either succeeds as a whole or fails as a whole (callers
 * degrade on failure); there is no "partially ready" in-between state.
 */
export interface AgentServices {
  sessionManager: SessionManager
  checkpointer: CheckpointerManager
  memoryManager: MemoryManager
  memoryExtractor: MemoryExtractor
  editLogStore: EditLogStore
}

/**
 * The single assembly point: instantiate and wire every agent-side service.
 * Fixed assembly order: create the memory directory → sessionManager.init →
 * checkpointer.initWithDbPath → sessionManager.setCheckpointer(checkpointer)
 * (cross-wiring) → construct the three memory components.
 */
export async function initAgentServices(userDataPath: string): Promise<AgentServices> {
  const dbDir = path.join(userDataPath, 'memory')
  await fs.promises.mkdir(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'app.db')

  const sessionManager = new SessionManager()
  await sessionManager.init(userDataPath)

  const checkpointer = new CheckpointerManager()
  await checkpointer.initWithDbPath(dbPath)
  sessionManager.setCheckpointer(checkpointer)

  const memoryManager = new MemoryManager(userDataPath)
  const memoryExtractor = new MemoryExtractor(memoryManager)
  const editLogStore = new EditLogStore(userDataPath)

  return { sessionManager, checkpointer, memoryManager, memoryExtractor, editLogStore }
}
