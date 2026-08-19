import type { BrowserWindow } from 'electron'
import type { AgentOrchestrator } from '../../agent/orchestrator.js'
import type { SessionManager } from '../../agent/context/sessionManager.js'
import type { EditLogStore } from '../../agent/memory/editLogStore.js'
import type { StreamManager } from '../../agent/streamManager.js'
import type { FileSystemService } from '../../fs/index.js'
import type { AppSettings } from '../../fs/types.js'
import type { ChatStreamEvent } from '../../ipc.js'
import type { McpManager } from '../../mcp/mcpManager.js'
import type { MindmapReadRequester } from '../mindmapRead.js'
import type { MindmapWriteRequester } from '../mindmapWrite.js'

/**
 * 所有 handler 模块共享的依赖载体。模块内部不构造任何服务——
 * 一律经此上下文取用 main.ts 装配好的依赖与跨服务接线。
 */
export interface HandlerContext {
  fsService: FileSystemService
  /** 可空窄字段：AI 服务装配失败时为 null，消费方在就绪门控后自行防御。 */
  sessionManager: SessionManager | null
  /** 可空窄字段：AI 服务装配失败时为 null。 */
  editLogStore: EditLogStore | null
  getWindow: () => BrowserWindow | null
  /** 主进程 → 渲染层读导图请求器（requestId 关联 + 超时），装配时创建。 */
  mindmapReadRequester: MindmapReadRequester
  /** 主进程 → 渲染层落盘请求器（requestId 关联 + 超时），装配时创建。 */
  mindmapWriteRequester: MindmapWriteRequester
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
