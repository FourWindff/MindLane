import type { ChatMessage, DocumentRef, MindLaneFile } from '../contracts/fileFormat'

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
import type { McpServerStatusInfo } from './mcp/types.js'

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
  AiGetCapabilities = 'ai:get-capabilities',
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

// ---- 结果信封（Result Envelope） ----
// 跨进程边界的结果信封：可失败操作返回，必然成功的读取不包信封。

export type IpcResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

// ---- 边界 DTO（Boundary DTOs） ----

/** mcp:connect 载荷：OAuth server 只带 serverId，非 OAuth server 附带表单凭据 */
export interface McpConnectPayload {
  serverId: string
  /** 非 OAuth server 的表单凭据（按定义的 credentialFields 校验），OAuth server 省略 */
  credentials?: Record<string, string>
}

/** mcp:authorize-uat 载荷：飞书一键授权的 app 凭证（用于发起 OAuth 与换 token） */
export interface McpAuthorizeUatPayload {
  serverId: string
  appId: string
  appSecret: string
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
  workspaceUuid: string | null
  activeSessionIds: Record<string, string>
  /** 会话文件索引：fileUuid -> filePath，跨启动渲染胶囊条用。 */
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

// ---- 桥（Bridge）契约 ----
// 渲染层访问主进程能力的唯一门户。preload 实现与渲染层类型引用同一份，
// 编译器看守：实现不满足契约即编译失败。

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
    getCapabilities: () => Promise<
      { ok: true; capabilities: string[] } | { ok: false; error: string }
    >
    /** 只读裸布尔：AI 服务就绪状态（装配成功与否），不包 IpcResult 信封。 */
    isReady: () => Promise<boolean>
    /** 主进程 → 渲染层：按需读导图请求（requestId 关联）。 */
    onMindmapReadRequest: (callback: (request: MindmapReadRequest) => void) => () => void
    /** 渲染层 → 主进程：读导图应答。 */
    respondMindmapRead: (payload: MindmapReadResponse) => Promise<void>
    /** 主进程 → 渲染层：落盘请求（requestId 关联，复用 mindmap-read 模式）。 */
    onMindmapWriteRequest: (callback: (request: MindmapWriteRequest) => void) => () => void
    /** 渲染层 → 主进程：落盘应答（未知 requestId 为 no-op）。 */
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
    /** 更新会话文件索引单条映射（改名/移动后修正路径用）。 */
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
    moveItem: (payload: {
      sourcePath: string
      targetDirPath: string
      workspacePath: string
    }) => Promise<IpcResult<{ newPath: string }>>
  }
  chat: {
    listSessions: (payload: {
      workspacePath: string
      /** 省略时返回当前 workspace 全量会话（保持按 updatedAt 降序、支持 limit/offset）。 */
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
    /** 一键获取飞书用户 UAT：拉起授权页，成功后把 uat 回填到连接表单 */
    mcpAuthorizeUat: (payload: {
      serverId: string
      appId: string
      appSecret: string
    }) => Promise<
      { ok: true; data: { uat: string; expiresIn: number } } | { ok: false; error: string }
    >
    /** 读取表单配置类 server 已保存的凭据（非 OAuth 连接配置），用于“显示配置”回填 */
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
    /** 用系统默认浏览器打开外链（仅 http/https，防指令注入） */
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
