import type { ChatMessage, DocumentRef, MindLaneFile } from '../contracts/fileFormat.js'

import type {
  ChatContext,
  ChatStreamEvent,
  EphemeralRunRequest,
  MindmapReadRequest,
  MindmapReadResponse,
  MindmapWriteRequest,
  MindmapWriteResponse,
} from '../contracts/ipc.js'
import type { AppSettings, WorkspaceState } from './fs/types.js'
import type { McpServerStatusInfo } from './agent/mcp/types.js'

export enum IPC {
  MainProcessMessage = 'main-process-message',
  AppBeforeClose = 'app:before-close',

  AiChatStream = 'ai:chat-stream',
  AiChatStreamStop = 'ai:chat-stream-stop',
  AiChatStreamEvent = 'ai:chat-stream-event',
  AiMindmapReadRequest = 'ai:mindmap-read-request',
  AiMindmapReadRespond = 'ai:mindmap-read-respond',
  AiMindmapWriteRequest = 'ai:mindmap-write-request',
  AiMindmapWriteRespond = 'ai:mindmap-write-respond',
  AiGetProviders = 'ai:get-providers',
  AiIsReady = 'ai:is-ready',

  FileOpen = 'file:open',
  FileSave = 'file:save',
  FileSaveAs = 'file:save-as',
  FileSaveThumbnail = 'file:save-thumbnail',
  FileSelectDocument = 'file:select-document',
  FileSettingsLoad = 'file:settings-load',
  FileSettingsUpdate = 'file:settings-update',

  WorkspaceOpenDirectory = 'workspace:open-directory',
  WorkspaceCreateDirectory = 'workspace:create-directory',
  WorkspaceCreateFile = 'workspace:create-file',
  WorkspaceOpenFilePath = 'workspace:open-file-path',
  WorkspaceGetSession = 'workspace:get-session',
  WorkspaceUpdateState = 'workspace:update-state',
  WorkspaceSwitch = 'workspace:switch',
  WorkspaceListTree = 'workspace:list-tree',
  WorkspaceCreateSubfolder = 'workspace:create-subfolder',
  WorkspaceDeleteItem = 'workspace:delete-item',
  WorkspaceRenameItem = 'workspace:rename-item',
  WorkspaceUpdateFileUuidPath = 'workspace:update-file-uuid-path',

  ChatListSessions = 'chat:list-sessions',
  ChatLoadSession = 'chat:load-session',
  ChatDeleteSession = 'chat:delete-session',

  McpConnect = 'mcp:connect',
  McpDisconnect = 'mcp:disconnect',
  McpStatus = 'mcp:status',
  McpAuthorizeUat = 'mcp:authorize-uat',
  McpGetCredentials = 'mcp:get-credentials',

  ShellOpenDocumentRef = 'shell:open-document-ref',
  ShellOpenLogs = 'shell:open-logs',
  ShellOpenExternal = 'shell:open-external',
  ShellLogError = 'shell:log-error',
  ShellLogWarning = 'shell:log-warning',

  EditlogAppend = 'editlog:append',

  WindowMinimize = 'window:minimize',
  WindowToggleMaximize = 'window:toggle-maximize',
  WindowClose = 'window:close',
  WindowCloseConfirmed = 'window:close-confirmed',
}

// ---- Result envelope ----
// The result envelope used across the process boundary: returned by operations that can fail;
// reads that cannot fail are not wrapped.

export type IpcResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

// ---- Boundary DTOs ----

/** mcp:connect payload: OAuth servers carry only serverId; non-OAuth servers attach form credentials */

export interface McpConnectPayload {
  serverId: string
  /** Form credentials for non-OAuth servers (validated against the declared credentialFields); omitted for OAuth servers */
  credentials?: Record<string, string>
}

/** mcp:authorize-uat payload: app credentials for Feishu one-click authorization (used to start OAuth and exchange the token) */
export interface McpAuthorizeUatPayload {
  serverId: string
  appId: string
  appSecret: string
}

export interface WorkspaceTreeEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  lastModifiedAt: string
  children?: WorkspaceTreeEntry[]
  previewUrl?: string
}

interface SelectedDocumentInfo {
  path: string
  name: string
  size: number
  mtimeMs: number
  sha256: string
  type: DocumentRef['type']
}

interface WorkspaceSession {
  workspacePath: string | null
  activeSessionIds: Record<string, string>
  /** Session file index: fileUuid -> filePath, used by the renderer's capsule bar across launches. */
  fileUuidPaths: Record<string, string>
  recentWorkspacePaths: string[]
  lastOpenedFilePath: string | null
  restoreLastWorkspaceOnLaunch: boolean
}

interface ChatSessionMeta {
  id: string
  fileUuid: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

type ChatLoadSessionResult = {
  ok: true
  data: {
    sessionId: string
    messages: ChatMessage[]
  }
}

// ---- Bridge contract ----
// The only gateway through which the renderer reaches main-process capabilities. The preload
// implementation and the renderer types reference the same declaration; the compiler guards
// that an implementation not satisfying the contract fails to compile.

export * from '../contracts/ipc.js'
export type { PalaceStationPayload, PalaceRunPayload } from '../contracts/palace.js'
export * from '../contracts/turnState.js'
export type { PalaceArtworkStyle } from '../contracts/palaceArtworkStyle.js'

export interface MindLaneBridge {
  ai: {
    chatStream: (payload: {
      threadId: string
      message: string
      context: ChatContext
      /** Present = ephemeral run: no session IO, private thread, entry marker. */
      ephemeral?: EphemeralRunRequest
    }) => Promise<{ ok: true; streamId: string } | { ok: false; error: string }>
    stopStream: (streamId: string) => Promise<{ ok: boolean }>
    onStreamEvent: (callback: (event: ChatStreamEvent) => void) => () => void
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
    /** Read-only bare boolean: AI service readiness (whether assembly succeeded), not wrapped in an IpcResult envelope. */
    isReady: () => Promise<boolean>
    /** Main process -> renderer: on-demand mindmap read request (correlated by requestId). */
    onMindmapReadRequest: (callback: (request: MindmapReadRequest) => void) => () => void
    /** Renderer -> main process: mindmap read response. */
    respondMindmapRead: (payload: MindmapReadResponse) => Promise<void>
    /** Main process -> renderer: save-to-disk request (correlated by requestId, reusing the mindmap-read pattern). */
    onMindmapWriteRequest: (callback: (request: MindmapWriteRequest) => void) => () => void
    /** Renderer -> main process: save-to-disk response (unknown requestId is a no-op). */
    respondMindmapWrite: (payload: MindmapWriteResponse) => Promise<void>
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
    /** Update one session file index mapping (used to fix the path after a rename/move). */
    updateFileUuidPath: (payload: {
      workspacePath: string
      fileUuid: string
      filePath: string
    }) => Promise<{ ok: true } | { ok: false; error: string }>
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
  }
  chat: {
    listSessions: (payload: {
      workspacePath: string
      /** When omitted, returns all sessions of the current workspace (still sorted by updatedAt descending, honoring limit/offset). */
      fileUuid?: string
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
    mcpConnect: (
      serverId: string,
      credentials?: Record<string, string>,
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    mcpDisconnect: (serverId: string) => Promise<{ ok: true } | { ok: false; error: string }>
    mcpStatus: () => Promise<
      { ok: true; data: McpServerStatusInfo[] } | { ok: false; error: string }
    >
    /** One-click Feishu user UAT: opens the authorization page and fills the uat back into the connection form */
    mcpAuthorizeUat: (payload: {
      serverId: string
      appId: string
      appSecret: string
    }) => Promise<
      { ok: true; data: { uat: string; expiresIn: number } } | { ok: false; error: string }
    >
    /** Read saved credentials for form-config servers (non-OAuth connection config), used to repopulate the "Show config" view */
    mcpGetCredentials: (
      serverId: string,
    ) => Promise<{ ok: true; data: Record<string, string> } | { ok: false; error: string }>
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
    /** Open an external link in the system default browser (http/https only, prevents command injection) */
    openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>
    /**
     * Fire-and-forget renderer error report: the main process writes it to the
     * diagnostic log under the `renderer` context. No result, the renderer never
     * awaits — renderer errors have no UI outlet (PRD: errors live in the log).
     */
    logError: (message: string) => void
    /** Fire-and-forget recoverable renderer warning written to the diagnostic log. */
    logWarning: (message: string) => void
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
