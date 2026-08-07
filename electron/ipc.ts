import type { ChatMessage, DocumentRef, MindLaneFile } from '../src/shared/lib/fileFormat'
import type { AppSettings, WorkspaceState } from './fs/types'
import type { McpServerStatusInfo } from './mcp/types'

export enum IPC {
  MainProcessMessage = 'main-process-message',
  AppBeforeClose = 'app:before-close',

  AiChatStream = 'ai:chat-stream',
  AiChatStreamStop = 'ai:chat-stream-stop',
  AiChatStreamEvent = 'ai:chat-stream-event',
  AiNodesToPalace = 'ai:nodes-to-palace',
  AiListProviders = 'ai:list-providers',
  AiGetProviders = 'ai:get-providers',
  AiGetCapabilities = 'ai:get-capabilities',

  ImageUrlToDataUrl = 'image:url-to-data-url',

  FileOpen = 'file:open',
  FileSave = 'file:save',
  FileSaveAs = 'file:save-as',
  FileRecentList = 'file:recent-list',
  FileSaveThumbnail = 'file:save-thumbnail',
  FileSelectDocument = 'file:select-document',
  FileSettingsLoad = 'file:settings-load',
  FileSettingsUpdate = 'file:settings-update',

  WorkspaceOpenDirectory = 'workspace:open-directory',
  WorkspaceCreateDirectory = 'workspace:create-directory',
  WorkspaceCreateFile = 'workspace:create-file',
  WorkspaceListFiles = 'workspace:list-files',
  WorkspaceOpenFilePath = 'workspace:open-file-path',
  WorkspaceGetSession = 'workspace:get-session',
  WorkspaceUpdateState = 'workspace:update-state',
  WorkspaceSwitch = 'workspace:switch',
  WorkspaceListTree = 'workspace:list-tree',
  WorkspaceCreateSubfolder = 'workspace:create-subfolder',
  WorkspaceDeleteItem = 'workspace:delete-item',
  WorkspaceRenameItem = 'workspace:rename-item',
  WorkspaceMoveItem = 'workspace:move-item',

  ChatListSessions = 'chat:list-sessions',
  ChatLoadSession = 'chat:load-session',
  ChatDeleteSession = 'chat:delete-session',

  McpConnect = 'mcp:connect',
  McpDisconnect = 'mcp:disconnect',
  McpStatus = 'mcp:status',

  ShellOpenDocumentRef = 'shell:open-document-ref',
  ShellOpenLogs = 'shell:open-logs',

  EditlogAppend = 'editlog:append',

  WindowMinimize = 'window:minimize',
  WindowToggleMaximize = 'window:toggle-maximize',
  WindowClose = 'window:close',
  WindowCloseConfirmed = 'window:close-confirmed',
  WindowOpenDevtools = 'window:open-devtools',
}

// ---- 结果信封（Result Envelope） ----
// 跨进程边界的结果信封：可失败操作返回，必然成功的读取不包信封。

export type IpcResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

// ---- 边界 DTO（Boundary DTOs） ----

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

export interface SelectedDocumentInfo {
  path: string
  name: string
  size: number
  mtimeMs: number
  sha256: string
  type: DocumentRef['type']
}

export interface WorkspaceSession {
  workspacePath: string | null
  workspaceUuid: string | null
  activeSessionIds: Record<string, string>
  recentWorkspacePaths: string[]
  lastOpenedFilePath: string | null
  restoreLastWorkspaceOnLaunch: boolean
}

export interface ChatSessionMeta {
  id: string
  fileUuid: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export type ChatLoadSessionResult = {
  ok: true
  data: {
    sessionId: string
    messages: ChatMessage[]
  }
}

export type SelectedNodeContent = { id: string; label: string }

export interface ContextNodeInfo {
  id: string
  type: 'text' | 'palace'
  label: string
  extra?: Record<string, unknown>
}

export interface WorkspaceFileInfo {
  name: string
  filePath: string
}

export interface ChatContext {
  fileUuid: string
  mindmapSummary?: string
  selectedNodes?: ContextNodeInfo[]
  filePath?: string
  fileTitle?: string
  hasDocumentOpen?: boolean
  workspacePath?: string
  workspaceFiles?: WorkspaceFileInfo[]
  attachedDocument?: DocumentRef
  linkedDocuments?: DocumentRef[]
  fileTags?: string[]
}

export interface ChatStreamEvent {
  streamId: string
  sessionId: string
  type: 'token' | 'message-start' | 'tool-start' | 'tool-end' | 'step' | 'end' | 'error'
  payload: unknown
}

export type NodesToPalaceResult =
  | {
      ok: true
      label: string
      stations: Array<{
        order: number
        content: string
        anchorVisual: string
        association?: string
        x: number
        y: number
        linkedNodeId: string
      }>
      imageUrl: string
      sourceNodeIds: string[]
    }
  | { ok: false; error: string }

// ---- 桥（Bridge）契约 ----
// 渲染层访问主进程能力的唯一门户。preload 实现与渲染层类型引用同一份，
// 编译器看守：实现不满足契约即编译失败。

export interface MindlaneBridge {
  ai: {
    chatStream: (payload: {
      threadId: string
      message: string
      context: ChatContext
    }) => Promise<{ ok: true; streamId: string } | { ok: false; error: string }>
    stopStream: (streamId: string) => Promise<{ ok: boolean }>
    onStreamEvent: (callback: (event: ChatStreamEvent) => void) => () => void
    nodesToPalace: (payload: {
      selectedNodes: SelectedNodeContent[]
    }) => Promise<NodesToPalaceResult>
    listProviders: () => Promise<{
      chat: {
        id: string
        displayName: string
        models: { id: string; displayName: string }[]
        capabilities: string[]
      }[]
      image: { id: string; displayName: string }[]
    }>
    getProviders: () => Promise<
      | {
          ok: true
          providers: {
            id: string
            displayName: string
            capabilities: string[]
            models: { id: string; displayName: string }[]
          }[]
        }
      | { ok: false; error: string }
    >
    getCapabilities: () => Promise<
      { ok: true; capabilities: string[] } | { ok: false; error: string }
    >
    urlToDataUrl: (payload: { url: string }) => Promise<IpcResult<{ dataUrl: string }>>
  }
  file: {
    open: () => Promise<IpcResult<{ filePath: string; data: MindLaneFile }>>
    save: (payload: {
      filePath: string | null
      data: unknown
    }) => Promise<IpcResult<{ filePath: string; data: MindLaneFile }>>
    saveAs: (payload: {
      data: unknown
    }) => Promise<IpcResult<{ filePath: string; data: MindLaneFile }>>
    recentList: () => Promise<RecentFileEntry[]>
    saveThumbnail: (payload: {
      filePath: string
      imageData: string
    }) => Promise<IpcResult<{ previewUrl: string }>>
    selectDocument: () => Promise<IpcResult<SelectedDocumentInfo>>
  }
  workspace: {
    openDirectory: () => Promise<IpcResult<{ workspacePath: string }>>
    createDirectory: (payload: { name: string }) => Promise<IpcResult<{ workspacePath: string }>>
    createFile: (payload: {
      workspacePath: string
      name: string
      data: unknown
    }) => Promise<IpcResult<{ filePath: string; data: unknown }>>
    listFiles: (payload: { workspacePath: string }) => Promise<IpcResult<WorkspaceFileEntry[]>>
    openFilePath: (payload: {
      filePath: string
    }) => Promise<IpcResult<{ filePath: string; data: MindLaneFile }>>
    getSession: () => Promise<WorkspaceSession>
    updateState: (
      payload: {
        workspacePath: string
        activeSession?: { fileUuid: string; sessionId: string }
      } & Partial<WorkspaceState>,
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    switchDirectory: (payload: {
      workspacePath: string
    }) => Promise<IpcResult<{ workspacePath: string }>>
    listTree: (payload: { workspacePath: string }) => Promise<IpcResult<WorkspaceTreeEntry[]>>
    createSubfolder: (payload: {
      parentPath: string
      name: string
      workspacePath: string
    }) => Promise<IpcResult<{ path: string }>>
    deleteItem: (payload: {
      targetPath: string
      workspacePath: string
    }) => Promise<{ ok: true } | { ok: false; error: string }>
    renameItem: (payload: {
      oldPath: string
      newName: string
      workspacePath: string
    }) => Promise<IpcResult<{ newPath: string }>>
    moveItem: (payload: {
      sourcePath: string
      targetDirPath: string
      workspacePath: string
    }) => Promise<IpcResult<{ newPath: string }>>
  }
  chat: {
    listSessions: (payload: {
      workspacePath: string
      fileUuid: string
      limit?: number
      offset?: number
    }) => Promise<IpcResult<{ sessions: ChatSessionMeta[] }>>
    loadSession: (payload: {
      workspacePath: string
      sessionId: string
    }) => Promise<ChatLoadSessionResult>
    deleteSession: (payload: {
      workspacePath: string
      sessionId: string
    }) => Promise<{ ok: true } | { ok: false; error: string }>
  }
  settings: {
    load: () => Promise<AppSettings>
    update: (partial: Record<string, unknown>) => Promise<void>
    mcpConnect: (serverId: string) => Promise<{ ok: true } | { ok: false; error: string }>
    mcpDisconnect: (serverId: string) => Promise<{ ok: true } | { ok: false; error: string }>
    mcpStatus: () => Promise<
      { ok: true; data: McpServerStatusInfo[] } | { ok: false; error: string }
    >
  }
  window: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    closeConfirmed: () => Promise<void>
    onBeforeClose: (callback: () => void) => () => void
    onMainProcessMessage: (callback: (message: string) => void) => () => void
  }
  shell: {
    openDocumentRef: (doc: DocumentRef) => Promise<{ ok: true } | { ok: false; error: string }>
    openLogs: () => Promise<{ ok: true }>
  }
  editlog: {
    /** Fire-and-forget report of a user node-text edit; the renderer never awaits a result. */
    append: (payload: {
      workspacePath: string
      fileUuid: string
      nodeId: string
      before: string
      after: string
    }) => void
  }
}
