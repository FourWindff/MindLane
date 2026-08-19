import type {
  ChatMessage,
  ChatToolCall,
  DocumentRef,
  MindLaneEdge,
  MindLaneFile,
  MindLaneNode,
} from '../src/shared/lib/fileFormat'
import type { AppSettings, WorkspaceState } from './fs/types'
import type { McpServerStatusInfo } from './mcp/types'

export enum IPC {
  MainProcessMessage = 'main-process-message',
  AppBeforeClose = 'app:before-close',

  AiChatStream = 'ai:chat-stream',
  AiChatStreamStop = 'ai:chat-stream-stop',
  AiChatStreamEvent = 'ai:chat-stream-event',
  AiMindmapReadRequest = 'ai:mindmap-read-request',
  AiMindmapReadRespond = 'ai:mindmap-read-respond',
  AiNodesToPalace = 'ai:nodes-to-palace',
  AiListProviders = 'ai:list-providers',
  AiGetProviders = 'ai:get-providers',
  AiGetCapabilities = 'ai:get-capabilities',
  AiIsReady = 'ai:is-ready',

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
  WorkspaceUpdateFileUuidPath = 'workspace:update-file-uuid-path',

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

/** mcp:connect 载荷：OAuth server 只带 serverId，非 OAuth server 附带表单凭据 */
export interface McpConnectPayload {
  serverId: string
  /** 非 OAuth server 的表单凭据（按定义的 credentialFields 校验），OAuth server 省略 */
  credentials?: Record<string, string>
}

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
  /** 会话文件索引：fileUuid -> filePath，跨启动渲染胶囊条用。 */
  fileUuidPaths: Record<string, string>
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
  /** 根节点链（root → … → 本节点，compact 轮次状态用） */
  chain?: string[]
  /** 直接子节点（compact 子树，深度 1） */
  children?: ContextNodeInfo[]
  extra?: Record<string, unknown>
}

export interface WorkspaceFileInfo {
  name: string
  filePath: string
}

export interface ChatContext {
  fileUuid: string
  selectedNodes?: ContextNodeInfo[]
  filePath?: string
  fileTitle?: string
  hasDocumentOpen?: boolean
  workspacePath?: string
  workspaceFiles?: WorkspaceFileInfo[]
  attachedDocument?: DocumentRef
  linkedDocuments?: DocumentRef[]
}

// ---- 轮次状态（Turn State）契约 ----
// 序列化与剥离的单一实现：主进程持久化、UI 展示、滚动摘要、记忆提取
// 四个消费方共享同一份代码，避免各写一份导致漂移。

/** 轮次状态 XML 块的根标签名。 */
export const EDITOR_STATE_TAG = 'EDITOR_STATE'

/** XML 属性值转义：`<` `>` `&` `"` 不破坏结构。 */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 把 `ChatContext` 序列化为 `<EDITOR_STATE>` XML 块（轮次状态）。
 *
 * 结构约定：根标签携带文件身份属性（file_uuid / file_path / file_title）；
 * `<SELECTED_NODES count>` 恒发（空选 count="0" 且无子节点）；
 * `<ATTACHED_DOCUMENT>` / `<LINKED_DOCUMENTS>` 存在时才发。
 * 不含导图树摘要——模型需要完整结构时按需调用 `readMindmap` 读工具。
 */
export function serializeTurnState(context: ChatContext): string {
  let xml = `<${EDITOR_STATE_TAG} file_uuid="${xmlEscape(context.fileUuid)}" file_path="${xmlEscape(context.filePath ?? '')}" file_title="${xmlEscape(context.fileTitle ?? '')}">
`

  const selectedNodes = context.selectedNodes ?? []
  xml += `<SELECTED_NODES count="${selectedNodes.length}">
`
  for (const node of selectedNodes) {
    // 协议 XML 形状：id/type/content/collapsed；compact 模式带根节点链 + 直接子树
    const collapsed =
      (node as { collapsed?: boolean }).collapsed === true ? ' collapsed="true"' : ''
    const chain =
      node.chain && node.chain.length > 1 ? ` chain="${node.chain.map(xmlEscape).join(',')}"` : ''
    const children =
      (node as { children?: Array<{ id: string; type: string; label?: string }> }).children ?? []
    if (children.length === 0) {
      xml += `  <node id="${xmlEscape(node.id)}" type="${xmlEscape(node.type)}" content="${xmlEscape(node.label || '')}"${collapsed}${chain}/>
`
    } else {
      xml += `  <node id="${xmlEscape(node.id)}" type="${xmlEscape(node.type)}" content="${xmlEscape(node.label || '')}"${collapsed}${chain}>
`
      for (const child of children) {
        xml += `    <node id="${xmlEscape(child.id)}" type="${xmlEscape(child.type)}" content="${xmlEscape(child.label || '')}"/>
`
      }
      xml += `  </node>
`
    }
  }
  xml += `</SELECTED_NODES>
`

  if (context.attachedDocument) {
    const doc = context.attachedDocument
    xml += `<ATTACHED_DOCUMENT type="${xmlEscape(doc.type)}" filename="${xmlEscape(doc.filename)}" path="${xmlEscape(doc.source)}">
用户已附加文档「${xmlEscape(doc.filename)}」，请根据此文档内容生成思维导图。
</ATTACHED_DOCUMENT>
`
  }

  if (context.linkedDocuments && context.linkedDocuments.length > 0) {
    xml += `<LINKED_DOCUMENTS count="${context.linkedDocuments.length}">
`
    for (const doc of context.linkedDocuments) {
      xml += `  <document id="${xmlEscape(doc.id)}" type="${xmlEscape(doc.type)}" filename="${xmlEscape(doc.filename)}" text_cache_key="${xmlEscape(doc.id)}"/>
`
    }
    xml += `</LINKED_DOCUMENTS>
`
  }

  xml += `</${EDITOR_STATE_TAG}>`
  return xml
}

/**
 * 从消息文本末尾剥离 `<EDITOR_STATE>` 块（展示、滚动摘要、记忆提取共用）。
 *
 * 末尾锚定：只剥**末尾**的完整块（含其前的换行分隔），
 * 无块时 no-op，中间内容永不触碰。旧会话消息无块 → 原样返回。
 */
export function stripTurnState(text: string): string {
  const closeTag = `</${EDITOR_STATE_TAG}>`
  const closeIndex = text.lastIndexOf(closeTag)
  if (closeIndex < 0) return text
  // 块必须是文本末尾（允许尾随空白），否则视为普通内容。
  if (text.slice(closeIndex + closeTag.length).trim() !== '') return text

  const openTag = `<${EDITOR_STATE_TAG}`
  const openIndex = text.lastIndexOf(openTag, closeIndex)
  if (openIndex < 0) return text
  // 防止误剥 `<EDITOR_STATE_EXTRA>` 之类的前缀同名标签。
  const afterOpen = text[openIndex + openTag.length]
  if (afterOpen !== ' ' && afterOpen !== '>' && afterOpen !== '\n') return text

  // 剥掉开标签到末尾的整段，并去掉其前的换行分隔。
  return text.slice(0, openIndex).replace(/\r?\n+$/, '')
}

/** 读导图查询参数（PRD 6.2：树查询，非行寻址）。 */
export interface MindmapReadQuery {
  scope?: 'whole' | 'subtree'
  subtreeId?: string
  type?: string
  textContains?: string
  maxDepth?: number
}

/** 主进程 → 渲染层：按需读导图请求（requestId 关联并发 runner）。 */
export interface MindmapReadRequest {
  requestId: string
  fileUuid: string
  query?: MindmapReadQuery
  /** xml=mindmap 节 XML 片段（默认）；snapshot=写工具校验用节点/资源快照 */
  mode?: 'xml' | 'snapshot'
}

/** 渲染层 → 主进程：写工具校验快照。 */
export interface MindmapEditorSnapshot {
  nodeIds: string[]
  assetIds: string[]
  /** target → source（纯树，每节点至多一个父） */
  parents: Record<string, string>
}

/** 渲染层 → 主进程：读导图应答。 */
export type MindmapReadResponse =
  { requestId: string; ok: true; summary: string } | { requestId: string; ok: false; error: string }

/** 主进程经 `step` 事件可发出的步骤词表；渲染层 `AiPipelineStep` 是其超集。 */
export const STREAM_STEPS = [
  'generating-map',
  'reading-doc',
  'extracting',
  'merging',
  'finalizing',
] as const
export type StreamStep = (typeof STREAM_STEPS)[number]

export function isStreamStep(value: unknown): value is StreamStep {
  return typeof value === 'string' && STREAM_STEPS.some((step) => step === value)
}

/**
 * 把"当前轮"切片语义收敛为跨进程共享的唯一实现。
 * 边界 = 最后一条 `type === 'human' || role === 'user'` 的消息；
 * `previous` 含边界消息，`current` 不含；无边界时 `previous` = 全部、`current` = 空。
 * 两种消息模型（`BaseMessage.type` 与 `ChatMessage.role`）共用同一份语义。
 */
export function splitCurrentTurn<T extends { type?: string; role?: string }>(
  messages: readonly T[],
): { previous: T[]; current: T[] } {
  const boundaryIndex = messages.findLastIndex(
    (message) => message.type === 'human' || message.role === 'user',
  )
  if (boundaryIndex < 0) return { previous: [...messages], current: [] }
  return {
    previous: messages.slice(0, boundaryIndex + 1),
    current: messages.slice(boundaryIndex + 1),
  }
}

export interface StreamResponse {
  content: string
  messages?: Array<{ role: 'assistant'; content: string; toolCalls?: ChatToolCall[] }>
  toolCalls?: ChatToolCall[]
  mindmapData?: { nodes: MindLaneNode[]; edges: MindLaneEdge[]; title: string }
  /** 渲染层不消费，保持 unknown，不提前类型化。 */
  palaceData?: unknown
}

export type ChatStreamEvent =
  | { streamId: string; sessionId: string; type: 'message-start'; payload: null }
  | { streamId: string; sessionId: string; type: 'token'; payload: string }
  | { streamId: string; sessionId: string; type: 'step'; payload: StreamStep }
  | {
      streamId: string
      sessionId: string
      type: 'tool-start'
      payload: { name: string; input: Record<string, unknown> }
    }
  | {
      streamId: string
      sessionId: string
      type: 'tool-end'
      payload: { name: string; output: string }
    }
  | { streamId: string; sessionId: string; type: 'end'; payload: StreamResponse }
  | { streamId: string; sessionId: string; type: 'error'; payload: string }

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
    /** 只读裸布尔：AI 服务就绪状态（装配成功与否），不包 IpcResult 信封。 */
    isReady: () => Promise<boolean>
    /** 主进程 → 渲染层：按需读导图请求（requestId 关联）。 */
    onMindmapReadRequest: (callback: (request: MindmapReadRequest) => void) => () => void
    /** 渲染层 → 主进程：读导图应答。 */
    respondMindmapRead: (payload: MindmapReadResponse) => Promise<void>
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
