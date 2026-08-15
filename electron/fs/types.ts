import type { MessagePipelineConfig } from '../agent/context/pipelineTypes.js'
import type { McpServerUserState } from '../mcp/types.js'
import type { IpcResult, RecentFileEntry, WorkspaceFileEntry, WorkspaceTreeEntry } from '../ipc.js'

// 边界 DTO 与结果信封由契约模块单一声明，主进程 fs 域经 re-export 复用同一类型。
export type { IpcResult, RecentFileEntry, WorkspaceFileEntry, WorkspaceTreeEntry }

export interface MindmapStyleSettings {
  structureType: 'logic' | 'mindmap'
  visualVariant: 'card' | 'outline' | 'minimal'
  colorScheme: 'default' | 'rainbow' | 'warm' | 'ocean' | 'forest' | 'sunset' | 'night'
}

export interface AppSettings {
  apiKey: string
  chatModel: string
  activeProviders: {
    chat: string
  }
  providerConfigs: Record<string, ProviderConfig>
  editor: {
    autoSaveIntervalMs: number
    maxBackups: number
    cachePruneDays: number
  }
  recentFilesMax: number
  lastWorkspacePath: string | null
  recentWorkspacePaths: string[]
  restoreLastWorkspaceOnLaunch: boolean
  workspacePathsByUuid: Record<string, string>
  filePathsByUuid: Record<string, string>
  messagePipeline?: MessagePipelineConfig
  mindmapStyle?: Partial<MindmapStyleSettings>
  /** MCP 用户态：每个 server 的连接状态与非敏感展示信息（不含任何凭据） */
  mcpServers: Record<string, McpServerUserState>
}

export interface WorkspaceState {
  workspaceUuid: string
  activeSessionIds: Record<string, string>
  lastOpenedFilePath: string | null
  recentFiles: RecentFileEntry[]
}

export interface ProviderConfig {
  apiKey: string
  baseUrl?: string
  messagePipeline?: Partial<MessagePipelineConfig>
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  chatModel: '',
  activeProviders: { chat: 'dashscope' },
  providerConfigs: {},
  editor: {
    autoSaveIntervalMs: 30_000,
    maxBackups: 5,
    cachePruneDays: 30,
  },
  recentFilesMax: 10,
  lastWorkspacePath: null,
  recentWorkspacePaths: [],
  restoreLastWorkspaceOnLaunch: true,
  workspacePathsByUuid: {},
  filePathsByUuid: {},
  mcpServers: {},
}
