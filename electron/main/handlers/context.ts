import type { BrowserWindow } from 'electron'
import type { AgentOrchestrator } from '../../agent/orchestrator.js'
import type { AiService } from '../../agent/service.js'
import type { StreamManager } from '../../agent/streamManager.js'
import type { FileSystemService } from '../../fs/index.js'
import type { AppSettings } from '../../fs/types.js'
import type { ChatStreamEvent } from '../../ipc.js'
import type { McpManager } from '../../mcp/mcpManager.js'

/**
 * 所有 handler 模块共享的依赖载体。模块内部不构造任何服务——
 * 一律经此上下文取用 main.ts 装配好的依赖与跨服务接线。
 */
export interface HandlerContext {
  fsService: FileSystemService
  aiService: AiService
  getWindow: () => BrowserWindow | null
  getStreamManager: () => StreamManager | null
  /** 可空、惰性创建：主进程负责在首次需要时装配 AgentOrchestrator。 */
  getChatOrchestrator: () => Promise<AgentOrchestrator | null>
  getMcpManager: () => McpManager | null
  isAiServiceReady: () => boolean
  userDataPath: string
  eventSink: (event: ChatStreamEvent) => void
  invalidateStreamRuntime: () => void
  refreshLogSecrets: (settings: AppSettings) => void
  getForceClose: () => boolean
  setForceClose: (value: boolean) => void
}
