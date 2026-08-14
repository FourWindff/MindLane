import path from 'node:path'
import fs from 'node:fs'
import { CheckpointerManager } from './memory/checkpointer.js'
import { SessionManager } from './context/sessionManager.js'
import { MemoryManager } from './memory/memoryManager.js'
import { MemoryExtractor } from './memory/memoryExtractor.js'
import { EditLogStore } from './memory/editLogStore.js'

/**
 * agent 侧服务的装配结果。五个服务全非可选：装配函数要么全部成功、
 * 要么整体失败（调用方据此降级），不存在"部分就绪"的中间态。
 */
export interface AgentServices {
  sessionManager: SessionManager
  checkpointer: CheckpointerManager
  memoryManager: MemoryManager
  memoryExtractor: MemoryExtractor
  editLogStore: EditLogStore
}

/**
 * 唯一装配点：实例化并接线 agent 侧全部服务。
 * 装配顺序固定：建 memory 目录 → sessionManager.init → checkpointer.initWithDbPath
 * → sessionManager.setCheckpointer(checkpointer)（交叉接线）→ 构造三个 memory 组件。
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
