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

type BailianChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type MemoryPalaceStation = {
  order: number
  content: string
  x: number
  y: number
  anchorVisual?: string
  mnemonicMethod?: string
  association?: string
}

type PalaceChatResponse =
  | { ok: true; content: string; imageUrls?: string[]; memoryRoute?: MemoryPalaceStation[] }
  | { ok: false; error: string }

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
    chat: (payload: { apiKey: string; model: string; messages: BailianChatMessage[] }) =>
      ipcRenderer.invoke('ai:chat', payload) as Promise<PalaceChatResponse>,
    text2image: (payload: { apiKey: string; prompt: string; size?: string; n?: number }) =>
      ipcRenderer.invoke('ai:text2image', payload),
    nodesToPalace: (payload: { apiKey: string; model: string; selectedNodes: SelectedNodeContent[] }) =>
      ipcRenderer.invoke('ai:nodes-to-palace', payload),
    docToMindmap: (payload: { apiKey: string; model: string; documentText: string; documentFilename: string }) =>
      ipcRenderer.invoke('ai:doc-to-mindmap', payload),
    listProviders: () => ipcRenderer.invoke('ai:list-providers'),
    urlToDataUrl: (payload: { url: string }) =>
      ipcRenderer.invoke('image:url-to-data-url', payload) as Promise<FsResult<{ dataUrl: string }>>,
  },
  file: {
    open: () => ipcRenderer.invoke('file:open'),
    importDocument: () => ipcRenderer.invoke('file:import-document'),
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
  settings: {
    load: () => ipcRenderer.invoke('file:settings-load'),
    update: (partial: Record<string, unknown>) =>
      ipcRenderer.invoke('file:settings-update', partial),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    closeConfirmed: () => ipcRenderer.invoke('window:close-confirmed'),
    onBeforeClose: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('app:before-close', handler)
      return () => { ipcRenderer.off('app:before-close', handler) }
    },
  },
})
