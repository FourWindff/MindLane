import type { BrowserWindow } from 'electron'
import type { SessionManager } from '../../agent/context/sessionManager.js'
import type { StreamManager } from '../../agent/streamManager.js'
import type { InternalStateStore } from '../../store/internalStore.js'
import type { FileSystemService } from '../../fs/index.js'
import type { AppSettings } from '../../fs/types.js'
import type { McpManager } from '../../agent/mcp/mcpManager.js'

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
  /** Shared internal state store (sessions, active-session mappings, node edit history); null when AI assembly fails. */
  stateStore: InternalStateStore | null
  getWindow: () => BrowserWindow | null
  getStreamManager: () => StreamManager | null
  getMcpManager: () => McpManager | null
  isAiServiceReady: () => boolean
  userDataPath: string
  invalidateStreamRuntime: () => void
  refreshLogSecrets: (settings: AppSettings) => void
  setForceClose: (value: boolean) => void
}
