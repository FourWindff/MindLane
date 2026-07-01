import type { MessagePipelineConfig } from '../agent/context/pipelineTypes.js'

export type FsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export interface RecentFileEntry {
  filePath: string
  title: string
  lastOpenedAt: string
}

export interface WorkspaceFileEntry {
  filePath: string
  name: string
  lastModifiedAt: string
}

export interface WorkspaceTreeEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  lastModifiedAt: string
  children?: WorkspaceTreeEntry[]
  previewUrl?: string
}


export interface AppSettings {
  apiKey: string
  chatModel: string
  activeProviders: {
    chat: string
    image: string
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
  messagePipeline?: MessagePipelineConfig
}

export interface WorkspaceState {
  lastOpenedFilePath: string | null
  expandedFolderPaths: string[]
  recentFiles: RecentFileEntry[]
}

export interface ProviderConfig {
  apiKey: string
  baseUrl?: string
  messagePipeline?: Partial<MessagePipelineConfig>
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  chatModel: 'qwen-turbo',
  activeProviders: { chat: 'dashscope', image: 'dashscope' },
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
}
