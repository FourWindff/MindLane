import { ipcRenderer, contextBridge } from 'electron'
import { IPC } from './ipc.js'

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
  type: 'text' | 'palace'
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

import type { ChatMessage, ChatToolCall, DocumentRef } from '../src/shared/lib/fileFormat'
import type { WorkspaceState } from './fs/types'

type ChatSessionMeta = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

type ChatSessionMessagesPayload = {
  workspacePath: string
  messages: ChatMessage[]
}

type ChatLoadSessionResult = {
  ok: true
  data: {
    sessionId: string
    messages: ChatMessage[]
  }
}

type ChatSaveSessionPayload = ChatSessionMessagesPayload & {
  sessionId: string
}

type SelectedNodeContent = { id: string; label: string }

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
    chatStream: (payload: { threadId: string; message: string; context?: ChatContext }) =>
      ipcRenderer.invoke(IPC.AiChatStream, payload) as Promise<void>,
    stopStream: () => ipcRenderer.invoke(IPC.AiChatStreamStop) as Promise<void>,
    onStreamToken: (callback: (token: string) => void) => {
      const handler = (_event: unknown, token: string) => callback(token)
      ipcRenderer.on(IPC.AiChatStreamToken, handler)
      return () => {
        ipcRenderer.off(IPC.AiChatStreamToken, handler)
      }
    },
    onStreamMessageStart: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC.AiChatStreamMessageStart, handler)
      return () => {
        ipcRenderer.off(IPC.AiChatStreamMessageStart, handler)
      }
    },
    onStreamToolStart: (
      callback: (data: { name: string; input: Record<string, unknown> }) => void,
    ) => {
      const handler = (_event: unknown, data: { name: string; input: Record<string, unknown> }) =>
        callback(data)
      ipcRenderer.on(IPC.AiChatStreamToolStart, handler)
      return () => {
        ipcRenderer.off(IPC.AiChatStreamToolStart, handler)
      }
    },
    onStreamToolEnd: (callback: (data: { name: string; output: string }) => void) => {
      const handler = (_event: unknown, data: { name: string; output: string }) => callback(data)
      ipcRenderer.on(IPC.AiChatStreamToolEnd, handler)
      return () => {
        ipcRenderer.off(IPC.AiChatStreamToolEnd, handler)
      }
    },
    onStreamEnd: (
      callback: (response: {
        content: string
        messages?: Array<{ role: 'assistant'; content: string; toolCalls?: ChatToolCall[] }>
        toolCalls?: ChatToolCall[]
        mindmapData?: {
          nodes: Array<{
            id: string
            type: string
            position: { x: number; y: number }
            data: Record<string, unknown>
          }>
          edges: Array<{
            id: string
            source: string
            target: string
            type?: string
            className?: string
          }>
          title: string
        }
      }) => void,
    ) => {
      const handler = (_event: unknown, response: Parameters<typeof callback>[0]) =>
        callback(response)
      ipcRenderer.on(IPC.AiChatStreamEnd, handler)
      return () => {
        ipcRenderer.off(IPC.AiChatStreamEnd, handler)
      }
    },
    onStreamError: (callback: (error: string) => void) => {
      const handler = (_event: unknown, error: string) => callback(error)
      ipcRenderer.on(IPC.AiChatStreamError, handler)
      return () => {
        ipcRenderer.off(IPC.AiChatStreamError, handler)
      }
    },
    nodesToPalace: (payload: {
      apiKey: string
      model: string
      selectedNodes: SelectedNodeContent[]
    }) => ipcRenderer.invoke(IPC.AiNodesToPalace, payload),
    listProviders: () => ipcRenderer.invoke(IPC.AiListProviders),
    getProviders: () => ipcRenderer.invoke(IPC.AiGetProviders),
    getCapabilities: () => ipcRenderer.invoke(IPC.AiGetCapabilities),
    urlToDataUrl: (payload: { url: string }) =>
      ipcRenderer.invoke(IPC.ImageUrlToDataUrl, payload) as Promise<FsResult<{ dataUrl: string }>>,
  },
  file: {
    open: () => ipcRenderer.invoke(IPC.FileOpen),
    save: (payload: { filePath: string | null; data: unknown }) =>
      ipcRenderer.invoke(IPC.FileSave, payload),
    saveAs: (payload: { data: unknown }) => ipcRenderer.invoke(IPC.FileSaveAs, payload),
    recentList: () => ipcRenderer.invoke(IPC.FileRecentList),
    saveThumbnail: (payload: { filePath: string; imageData: string }) =>
      ipcRenderer.invoke(IPC.FileSaveThumbnail, payload) as Promise<
        { ok: true; data: { previewUrl: string } } | { ok: false; error: string }
      >,
    selectDocument: () =>
      ipcRenderer.invoke(IPC.FileSelectDocument) as Promise<
        | {
            ok: true
            data: { path: string; name: string; size: number; mtimeMs: number; sha256: string }
          }
        | { ok: false; error: string }
      >,
  },
  workspace: {
    openDirectory: () => ipcRenderer.invoke(IPC.WorkspaceOpenDirectory),
    createDirectory: (payload: { name: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceCreateDirectory, payload),
    createFile: (payload: { workspacePath: string; name: string; data: unknown }) =>
      ipcRenderer.invoke(IPC.WorkspaceCreateFile, payload) as Promise<
        { ok: true; data: { filePath: string; data: unknown } } | { ok: false; error: string }
      >,
    listFiles: (payload: { workspacePath: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceListFiles, payload) as Promise<
        { ok: true; data: WorkspaceFileEntry[] } | { ok: false; error: string }
      >,
    openFilePath: (payload: { filePath: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceOpenFilePath, payload),
    getSession: () =>
      ipcRenderer.invoke(IPC.WorkspaceGetSession) as Promise<{
        workspacePath: string | null
        recentWorkspacePaths: string[]
        lastOpenedFilePath: string | null
        expandedFolderPaths: string[]
        restoreLastWorkspaceOnLaunch: boolean
      }>,
    updateState: (payload: { workspacePath: string } & Partial<WorkspaceState>) =>
      ipcRenderer.invoke(IPC.WorkspaceUpdateState, payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    switchDirectory: (payload: { workspacePath: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceSwitch, payload) as Promise<
        | { ok: true; data: { workspacePath: string; files: WorkspaceFileEntry[] } }
        | { ok: false; error: string }
      >,
    listTree: (payload: { workspacePath: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceListTree, payload) as Promise<FsResult<WorkspaceTreeEntry[]>>,
    createSubfolder: (payload: { parentPath: string; name: string; workspacePath: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceCreateSubfolder, payload) as Promise<
        FsResult<{ path: string }>
      >,
    deleteItem: (payload: { targetPath: string; workspacePath: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceDeleteItem, payload) as Promise<FsResult>,
    renameItem: (payload: { oldPath: string; newName: string; workspacePath: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceRenameItem, payload) as Promise<
        FsResult<{ newPath: string }>
      >,
    moveItem: (payload: { sourcePath: string; targetDirPath: string; workspacePath: string }) =>
      ipcRenderer.invoke(IPC.WorkspaceMoveItem, payload) as Promise<FsResult<{ newPath: string }>>,
  },
  chat: {
    listSessions: (payload: { workspacePath: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke(IPC.ChatListSessions, payload) as Promise<
        { ok: true; data: { sessions: ChatSessionMeta[] } } | { ok: false; error: string }
      >,
    loadSession: (payload: { workspacePath: string; sessionId: string }) =>
      ipcRenderer.invoke(IPC.ChatLoadSession, payload) as Promise<ChatLoadSessionResult>,
    saveSession: (payload: ChatSaveSessionPayload) =>
      ipcRenderer.invoke(IPC.ChatSaveSession, payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    deleteSession: (payload: { workspacePath: string; sessionId: string }) =>
      ipcRenderer.invoke(IPC.ChatDeleteSession, payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
  settings: {
    load: () => ipcRenderer.invoke(IPC.FileSettingsLoad),
    update: (partial: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC.FileSettingsUpdate, partial),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WindowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.WindowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.WindowClose),
    closeConfirmed: () => ipcRenderer.invoke(IPC.WindowCloseConfirmed),
    onBeforeClose: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC.AppBeforeClose, handler)
      return () => {
        ipcRenderer.off(IPC.AppBeforeClose, handler)
      }
    },
  },
  shell: {
    openDocumentRef: (doc: DocumentRef) =>
      ipcRenderer.invoke('shell:open-document-ref', doc) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
})
