import { ipcRenderer, contextBridge } from 'electron'
import { IPC, type MindlaneBridge } from './ipc.js'
import type { ChatStreamEvent } from './ipc.js'

const api: MindlaneBridge = {
  ai: {
    chatStream: (payload) => ipcRenderer.invoke(IPC.AiChatStream, payload),
    stopStream: (streamId) => ipcRenderer.invoke(IPC.AiChatStreamStop, { streamId }),
    onStreamEvent: onChatStreamEvent,
    nodesToPalace: (payload) => ipcRenderer.invoke(IPC.AiNodesToPalace, payload),
    listProviders: () => ipcRenderer.invoke(IPC.AiListProviders),
    getProviders: () => ipcRenderer.invoke(IPC.AiGetProviders),
    getCapabilities: () => ipcRenderer.invoke(IPC.AiGetCapabilities),
    urlToDataUrl: (payload) => ipcRenderer.invoke(IPC.ImageUrlToDataUrl, payload),
  },
  file: {
    open: () => ipcRenderer.invoke(IPC.FileOpen),
    save: (payload) => ipcRenderer.invoke(IPC.FileSave, payload),
    saveAs: (payload) => ipcRenderer.invoke(IPC.FileSaveAs, payload),
    recentList: () => ipcRenderer.invoke(IPC.FileRecentList),
    saveThumbnail: (payload) => ipcRenderer.invoke(IPC.FileSaveThumbnail, payload),
    selectDocument: () => ipcRenderer.invoke(IPC.FileSelectDocument),
  },
  workspace: {
    openDirectory: () => ipcRenderer.invoke(IPC.WorkspaceOpenDirectory),
    createDirectory: (payload) => ipcRenderer.invoke(IPC.WorkspaceCreateDirectory, payload),
    createFile: (payload) => ipcRenderer.invoke(IPC.WorkspaceCreateFile, payload),
    listFiles: (payload) => ipcRenderer.invoke(IPC.WorkspaceListFiles, payload),
    openFilePath: (payload) => ipcRenderer.invoke(IPC.WorkspaceOpenFilePath, payload),
    getSession: () => ipcRenderer.invoke(IPC.WorkspaceGetSession),
    updateState: (payload) => ipcRenderer.invoke(IPC.WorkspaceUpdateState, payload),
    switchDirectory: (payload) => ipcRenderer.invoke(IPC.WorkspaceSwitch, payload),
    listTree: (payload) => ipcRenderer.invoke(IPC.WorkspaceListTree, payload),
    createSubfolder: (payload) => ipcRenderer.invoke(IPC.WorkspaceCreateSubfolder, payload),
    deleteItem: (payload) => ipcRenderer.invoke(IPC.WorkspaceDeleteItem, payload),
    renameItem: (payload) => ipcRenderer.invoke(IPC.WorkspaceRenameItem, payload),
    moveItem: (payload) => ipcRenderer.invoke(IPC.WorkspaceMoveItem, payload),
  },
  chat: {
    listSessions: (payload) => ipcRenderer.invoke(IPC.ChatListSessions, payload),
    loadSession: (payload) => ipcRenderer.invoke(IPC.ChatLoadSession, payload),
    deleteSession: (payload) => ipcRenderer.invoke(IPC.ChatDeleteSession, payload),
  },
  settings: {
    load: () => ipcRenderer.invoke(IPC.FileSettingsLoad),
    update: (partial) => ipcRenderer.invoke(IPC.FileSettingsUpdate, partial),
    mcpConnect: (serverId) => ipcRenderer.invoke(IPC.McpConnect, { serverId }),
    mcpDisconnect: (serverId) => ipcRenderer.invoke(IPC.McpDisconnect, { serverId }),
    mcpStatus: () => ipcRenderer.invoke(IPC.McpStatus),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WindowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.WindowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.WindowClose),
    closeConfirmed: () => ipcRenderer.invoke(IPC.WindowCloseConfirmed),
    onBeforeClose: (callback) => {
      const handler = () => callback()
      ipcRenderer.on(IPC.AppBeforeClose, handler)
      return () => {
        ipcRenderer.off(IPC.AppBeforeClose, handler)
      }
    },
    onMainProcessMessage: (callback) => {
      const handler = (_event: unknown, message: string) => callback(message)
      ipcRenderer.on(IPC.MainProcessMessage, handler)
      return () => {
        ipcRenderer.off(IPC.MainProcessMessage, handler)
      }
    },
  },
  shell: {
    openDocumentRef: (doc) => ipcRenderer.invoke(IPC.ShellOpenDocumentRef, doc),
    openLogs: () => ipcRenderer.invoke(IPC.ShellOpenLogs),
  },
  editlog: {
    append: (payload) => ipcRenderer.send(IPC.EditlogAppend, payload),
  },
}

function onChatStreamEvent(callback: (event: ChatStreamEvent) => void): () => void {
  const handler = (_event: unknown, event: ChatStreamEvent) => callback(event)
  ipcRenderer.on(IPC.AiChatStreamEvent, handler)
  return () => ipcRenderer.off(IPC.AiChatStreamEvent, handler)
}

contextBridge.exposeInMainWorld('mindlane', api)
