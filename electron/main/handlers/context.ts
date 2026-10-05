import type { BrowserWindow } from 'electron'
import type { SessionManager } from '../../agent/context/sessionManager.js'
import type { EditLogStore } from '../../agent/memory/editLogStore.js'
import type { StreamManager } from '../../agent/streamManager.js'
import type { FileSystemService } from '../../fs/index.js'
import type { AppSettings } from '../../fs/types.js'
import type { McpManager } from '../../agent/mcp/mcpManager.js'
import type {
  MindmapReadRequest,
  MindmapReadResponse,
  MindmapWriteRequest,
  MindmapWriteResponse,
} from '../../ipc.js'
import type { RendererRequester } from '../rendererRequester.js'

/**
 * The dependency carrier shared by all handler modules. Modules construct no services
 * themselves - they take the dependencies assembled by main.ts and the cross-service
 * wiring from this context.
 */
export interface HandlerContext {
  fsService: FileSystemService
  /** Nullable narrow field: null when AI service assembly fails; consumers defend themselves after the readiness gate. */
  sessionManager: SessionManager | null
  /** Nullable narrow field: null when AI service assembly fails. */
  editLogStore: EditLogStore | null
  getWindow: () => BrowserWindow | null
  /** Main process -> renderer mindmap read requester (requestId correlation + timeout), created at assembly time. */
  mindmapReadRequester: RendererRequester<MindmapReadRequest, MindmapReadResponse>
  /** Main process -> renderer save-to-disk requester (requestId correlation + timeout), created at assembly time. */
  mindmapWriteRequester: RendererRequester<MindmapWriteRequest, MindmapWriteResponse>
  getStreamManager: () => StreamManager | null
  getMcpManager: () => McpManager | null
  isAiServiceReady: () => boolean
  userDataPath: string
  invalidateStreamRuntime: () => void
  refreshLogSecrets: (settings: AppSettings) => void
  setForceClose: (value: boolean) => void
}
