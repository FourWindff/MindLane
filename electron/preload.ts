import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...rest) => listener(event, ...rest))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

type ContextNodeInfo = {
  id: string
  type: 'topic' | 'palace' | 'document'
  label: string
  extra?: Record<string, unknown>
}

type ChatContext = {
  mindmapSummary?: string
  selectedNodes?: ContextNodeInfo[]
  filePath?: string
  fileTitle?: string
  hasDocumentOpen?: boolean
  workspacePath?: string
  workspaceFiles?: { name: string; filePath: string }[]
}

type ChatToolCall = {
  name: string
  args: Record<string, unknown>
  result: string
}

type ChatSessionMeta = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

type SelectedNodeContent = { id: string; label: string }

type IndexedDocMeta = {
  id: string
  filename: string
  filePath: string
  indexedAt: string
  chunkCount: number
}

type IndexProgress = {
  phase: 'loading' | 'splitting' | 'embedding' | 'done' | 'error'
  filename: string
  progress: number
  error?: string
}

type MindmapGenerationProgress = {
  phase: 'preparing' | 'extracting' | 'merging' | 'finalizing' | 'done' | 'error'
  filename: string
  message?: string
  error?: string
}

type WorkspaceFileEntry = {
  filePath: string
  name: string
  lastModifiedAt: string
}

type WorkspaceTreeEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  lastModifiedAt: string
  children?: WorkspaceTreeEntry[]
}

type FsOk<T = void> = T extends void ? { ok: true } : { ok: true; data: T }
type FsErr = { ok: false; error: string }
type FsResult<T = void> = FsOk<T> | FsErr

contextBridge.exposeInMainWorld('mindlane', {
  ai: {
    chatStream: (payload: {
      threadId: string;
      message: string;
      context?: ChatContext
    }) => ipcRenderer.invoke('ai:chat-stream', payload) as Promise<void>,
    stopStream: () => ipcRenderer.invoke('ai:chat-stream-stop') as Promise<void>,
    onStreamToken: (callback: (token: string) => void) => {
      const handler = (_event: unknown, token: string) => callback(token)
      ipcRenderer.on('ai:chat-stream-token', handler)
      return () => { ipcRenderer.off('ai:chat-stream-token', handler) }
    },
    onStreamToolStart: (callback: (data: { name: string; input: Record<string, unknown> }) => void) => {
      const handler = (_event: unknown, data: { name: string; input: Record<string, unknown> }) => callback(data)
      ipcRenderer.on('ai:chat-stream-tool-start', handler)
      return () => { ipcRenderer.off('ai:chat-stream-tool-start', handler) }
    },
    onStreamToolEnd: (callback: (data: { name: string; output: string }) => void) => {
      const handler = (_event: unknown, data: { name: string; output: string }) => callback(data)
      ipcRenderer.on('ai:chat-stream-tool-end', handler)
      return () => { ipcRenderer.off('ai:chat-stream-tool-end', handler) }
    },
    onStreamEnd: (callback: (response: {
      content: string
      toolCalls?: ChatToolCall[]
      mindmapData?: {
        nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>
        edges: Array<{ id: string; source: string; target: string; type?: string; className?: string }>
        title: string
      }
    }) => void) => {
      const handler = (_event: unknown, response: Parameters<typeof callback>[0]) => callback(response)
      ipcRenderer.on('ai:chat-stream-end', handler)
      return () => { ipcRenderer.off('ai:chat-stream-end', handler) }
    },
    onStreamError: (callback: (error: string) => void) => {
      const handler = (_event: unknown, error: string) => callback(error)
      ipcRenderer.on('ai:chat-stream-error', handler)
      return () => { ipcRenderer.off('ai:chat-stream-error', handler) }
    },
    text2image: (payload: { apiKey: string; prompt: string; size?: string; n?: number }) =>
      ipcRenderer.invoke('ai:text2image', payload),
    nodesToPalace: (payload: { apiKey: string; model: string; selectedNodes: SelectedNodeContent[] }) =>
      ipcRenderer.invoke('ai:nodes-to-palace', payload),
    listProviders: () => ipcRenderer.invoke('ai:list-providers'),
    getProviders: () => ipcRenderer.invoke('ai:get-providers'),
    getCapabilities: () => ipcRenderer.invoke('ai:get-capabilities'),
    urlToDataUrl: (payload: { url: string }) =>
      ipcRenderer.invoke('image:url-to-data-url', payload) as Promise<FsResult<{ dataUrl: string }>>,
  },
  file: {
    open: () => ipcRenderer.invoke('file:open'),
    save: (payload: { filePath: string | null; data: unknown }) =>
      ipcRenderer.invoke('file:save', payload),
    saveAs: (payload: { data: unknown }) =>
      ipcRenderer.invoke('file:save-as', payload),
    recentList: () => ipcRenderer.invoke('file:recent-list'),
  },
  workspace: {
    openDirectory: () => ipcRenderer.invoke('workspace:open-directory'),
    createDirectory: (payload: { name: string }) =>
      ipcRenderer.invoke('workspace:create-directory', payload),
    createFile: (payload: { workspacePath: string; name: string; data: unknown }) =>
      ipcRenderer.invoke('workspace:create-file', payload) as Promise<
        | { ok: true; data: { filePath: string; data: unknown } }
        | { ok: false; error: string }
      >,
    listFiles: (payload: { workspacePath: string }) =>
      ipcRenderer.invoke('workspace:list-files', payload) as Promise<
        | { ok: true; data: WorkspaceFileEntry[] }
        | { ok: false; error: string }
      >,
    openFilePath: (payload: { filePath: string }) =>
      ipcRenderer.invoke('workspace:open-file-path', payload),
    getSession: () =>
      ipcRenderer.invoke('workspace:get-session') as Promise<{
        workspacePath: string | null
        recentWorkspacePaths: string[]
        lastOpenedFilePath: string | null
        restoreLastWorkspaceOnLaunch: boolean
      }>,
    switchDirectory: (payload: { workspacePath: string }) =>
      ipcRenderer.invoke('workspace:switch', payload) as Promise<
        | { ok: true; data: { workspacePath: string; files: WorkspaceFileEntry[] } }
        | { ok: false; error: string }
      >,
    listTree: (payload: { workspacePath: string }) =>
      ipcRenderer.invoke('workspace:list-tree', payload) as Promise<FsResult<WorkspaceTreeEntry[]>>,
    createSubfolder: (payload: { parentPath: string; name: string; workspacePath: string }) =>
      ipcRenderer.invoke('workspace:create-subfolder', payload) as Promise<FsResult<{ path: string }>>,
    deleteItem: (payload: { targetPath: string; workspacePath: string }) =>
      ipcRenderer.invoke('workspace:delete-item', payload) as Promise<FsResult>,
    renameItem: (payload: { oldPath: string; newName: string; workspacePath: string }) =>
      ipcRenderer.invoke('workspace:rename-item', payload) as Promise<FsResult<{ newPath: string }>>,
    moveItem: (payload: { sourcePath: string; targetDirPath: string; workspacePath: string }) =>
      ipcRenderer.invoke('workspace:move-item', payload) as Promise<FsResult<{ newPath: string }>>,
  },
  chat: {
    loadHistory: (payload: { workspacePath: string }) =>
      ipcRenderer.invoke('chat:load-history', payload) as Promise<{
        ok: true
        data: {
          threadId: string
          messages: Array<{
            role: 'user' | 'assistant' | 'system'
            content: string
            toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }>
          }>
        }
      }>,
    saveHistory: (payload: {
      workspacePath: string
      messages: Array<{
        role: string
        content: string
        toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }>
      }>
    }) => ipcRenderer.invoke('chat:save-history', payload) as Promise<{ ok: true } | { ok: false; error: string }>,
    // New multi-session APIs
    listSessions: (payload: { workspacePath: string }) =>
      ipcRenderer.invoke('chat:list-sessions', payload) as Promise<
        | { ok: true; data: { sessions: ChatSessionMeta[] } }
        | { ok: false; error: string }
      >,
    loadSession: (payload: { workspacePath: string; sessionId: string }) =>
      ipcRenderer.invoke('chat:load-session', payload) as Promise<{
        ok: true
        data: {
          sessionId: string
          messages: Array<{
            role: 'user' | 'assistant' | 'system'
            content: string
            toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }>
          }>
        }
      }>,
    saveSession: (payload: {
      workspacePath: string
      sessionId: string
      messages: Array<{
        role: string
        content: string
        toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }>
      }>
    }) => ipcRenderer.invoke('chat:save-session', payload) as Promise<{ ok: true } | { ok: false; error: string }>,
    deleteSession: (payload: { workspacePath: string; sessionId: string }) =>
      ipcRenderer.invoke('chat:delete-session', payload) as Promise<{ ok: true } | { ok: false; error: string }>,
  },
  kb: {
    uploadDocuments: () =>
      ipcRenderer.invoke('kb:upload-documents') as Promise<
        { ok: true; data: { indexed: IndexedDocMeta[] } } | { ok: false; error: string }
      >,
    listDocuments: () =>
      ipcRenderer.invoke('kb:list-documents') as Promise<IndexedDocMeta[]>,
    deleteDocument: (payload: { docId: string }) =>
      ipcRenderer.invoke('kb:delete-document', payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    onIndexProgress: (callback: (progress: IndexProgress) => void) => {
      const handler = (_event: unknown, progress: IndexProgress) => callback(progress)
      ipcRenderer.on('kb:index-progress', handler)
      return () => { ipcRenderer.off('kb:index-progress', handler) }
    },
  },
  mindmap: {
    generateFromFile: (payload: { filePath?: string | null } = {}) =>
      ipcRenderer.invoke('mindmap:generate-from-file', payload) as Promise<
        | {
            ok: true
            data: {
              yamlContent: string
              yamlPath: string
              documentTitle: string
              pageCount: number
            }
          }
        | { ok: false; error: string; canceled?: boolean; phase?: string }
      >,
    onGenerationProgress: (callback: (progress: MindmapGenerationProgress) => void) => {
      const handler = (_event: unknown, progress: MindmapGenerationProgress) => callback(progress)
      ipcRenderer.on('mindmap:generation-progress', handler)
      return () => { ipcRenderer.off('mindmap:generation-progress', handler) }
    },
  },
  settings: {
    load: () => ipcRenderer.invoke('file:settings-load'),
    update: (partial: Record<string, unknown>) =>
      ipcRenderer.invoke('file:settings-update', partial),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    closeConfirmed: () => ipcRenderer.invoke('window:close-confirmed'),
    onBeforeClose: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('app:before-close', handler)
      return () => { ipcRenderer.off('app:before-close', handler) }
    },
  },
})
