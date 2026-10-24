import path from 'node:path'
import { SessionManager } from './sessionManager.js'
import { openInternalStore, type InternalStateStore } from '../../store/internalStore.js'

export interface TestSessionManager {
  manager: SessionManager
  stateStore: InternalStateStore
  /** Close both halves the harness opened (the production assembly owns them instead). */
  close(): void
}

/**
 * Test harness for the session persistence seam: a real internal state store in
 * the temp directory plus the production JSONL rollback mirror underneath.
 */
export async function createTestSessionManager(tmpDir: string): Promise<TestSessionManager> {
  const opened = openInternalStore(path.join(tmpDir, 'memory', 'state.db'))
  if (!opened.ok) throw new Error(opened.error)
  const manager = new SessionManager()
  await manager.init(tmpDir, opened.store)
  return {
    manager,
    stateStore: opened.store,
    close: () => {
      manager.close()
      opened.store.close()
    },
  }
}
