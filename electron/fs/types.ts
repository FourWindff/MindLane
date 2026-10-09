import type { McpServerUserState } from '../agent/mcp/types.js'
import type { IpcResult, PalaceArtworkStyle, WorkspaceTreeEntry } from '../ipc.js'

// Boundary DTOs and the result envelope are declared once in the contracts module; the main-process fs domain re-exports and reuses the same types.
export type { IpcResult, WorkspaceTreeEntry }

export interface AppSettings {
  chatModel: string
  palaceArtworkStyle: PalaceArtworkStyle
  activeProviders: {
    chat: string
  }
  providerConfigs: Record<string, ProviderConfig>
  editor: {
    autoSaveIntervalMs: number
  }
  /** Upper bound on the recent workspace path list (name kept for history; it applies to workspaces, not files). */
  recentFilesMax: number
  lastWorkspacePath: string | null
  recentWorkspacePaths: string[]
  restoreLastWorkspaceOnLaunch: boolean
  workspacePathsByUuid: Record<string, string>
  filePathsByUuid: Record<string, string>
  /** MCP user state: connection state and non-sensitive display info per server (no credentials) */
  mcpServers: Record<string, McpServerUserState>
}

export interface WorkspaceState {
  workspaceUuid: string
  activeSessionIds: Record<string, string>
  /** Session file index: a persistent fileUuid -> filePath map, used by the renderer's capsule bar across launches. */
  fileUuidPaths: Record<string, string>
  lastOpenedFilePath: string | null
}

export interface ProviderConfig {
  apiKey: string
  baseUrl?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  chatModel: '',
  palaceArtworkStyle: 'vector',
  activeProviders: { chat: 'dashscope' },
  providerConfigs: {},
  editor: {
    autoSaveIntervalMs: 30_000,
  },
  recentFilesMax: 10,
  lastWorkspacePath: null,
  recentWorkspacePaths: [],
  restoreLastWorkspaceOnLaunch: true,
  workspacePathsByUuid: {},
  filePathsByUuid: {},
  mcpServers: {},
}
