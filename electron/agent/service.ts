import path from 'node:path'
import fs from 'node:fs'
import { CheckpointerManager } from './memory/checkpointer.js'
import { SessionManager } from './context/sessionManager.js'
import { MemoryManager } from './memory/memoryManager.js'
import { MemoryExtractor } from './memory/memoryExtractor.js'
import { EditLogStore } from './memory/editLogStore.js'
import { openInternalStore, type InternalStateStore } from '../store/internalStore.js'

/**
 * Assembly result of the agent-side services. All six are non-optional: the
 * assembly function either succeeds as a whole or fails as a whole (callers
 * degrade on failure); there is no "partially ready" in-between state.
 */
export interface AgentServices {
  sessionManager: SessionManager
  checkpointer: CheckpointerManager
  memoryManager: MemoryManager
  memoryExtractor: MemoryExtractor
  editLogStore: EditLogStore
  /** Shared internal state store: queries never leak SQL past this handle. */
  stateStore: InternalStateStore
}

/**
 * The single assembly point: instantiate and wire every agent-side service.
 * Fixed assembly order: create the memory directory → open the internal state
 * store → sessionManager.init(stateStore) → checkpointer.initWithDbPath →
 * sessionManager.setCheckpointer(checkpointer) (cross-wiring) → construct the
 * three memory components.
 *
 * A store that cannot be opened (corrupt file, unsupported schema) fails the
 * whole assembly with the explicit store error, so the caller degrades AI
 * features while mindmap editing keeps working.
 */
export async function initAgentServices(userDataPath: string): Promise<AgentServices> {
  const dbDir = path.join(userDataPath, 'memory')
  await fs.promises.mkdir(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'app.db')

  const opened = openInternalStore(path.join(dbDir, 'state.db'))
  if (!opened.ok) throw new Error(opened.error)
  const stateStore = opened.store

  try {
    const sessionManager = new SessionManager()
    await sessionManager.init(userDataPath, stateStore)

    const checkpointer = new CheckpointerManager()
    await checkpointer.initWithDbPath(dbPath)
    sessionManager.setCheckpointer(checkpointer)

    const memoryManager = new MemoryManager(userDataPath)
    const memoryExtractor = new MemoryExtractor(memoryManager)
    const editLogStore = new EditLogStore(userDataPath)

    return {
      sessionManager,
      checkpointer,
      memoryManager,
      memoryExtractor,
      editLogStore,
      stateStore,
    }
  } catch (error) {
    stateStore.close()
    throw error
  }
}
