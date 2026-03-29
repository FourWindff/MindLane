/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string
    VITE_PUBLIC: string
  }
}

type _WorkspaceTreeEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  lastModifiedAt: string
  children?: _WorkspaceTreeEntry[]
}

type _FsOk<T = void> = T extends void ? { ok: true } : { ok: true; data: T }
type _FsResult<T = void> = _FsOk<T> | { ok: false; error: string }

interface Window {
  ipcRenderer: import('electron').IpcRenderer
  mindlane?: {
    ai: {
      chat: (payload: {
        apiKey: string
        model: string
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
      }) => Promise<
        | {
            ok: true
            content: string
            imageUrls?: string[]
            memoryRoute?: {
              order: number
              content: string
              x: number
              y: number
              anchorVisual?: string
            mnemonicMethod?: string
            association?: string
            }[]
          }
        | { ok: false; error: string }
      >
      text2image: (payload: {
        apiKey: string
        prompt: string
        size?: string
        n?: number
      }) => Promise<{ ok: true; urls: string[] } | { ok: false; error: string }>
      nodesToPalace: (payload: {
        apiKey: string
        model: string
        selectedNodes: { id: string; label: string }[]
      }) => Promise<
        | {
            ok: true
            label: string
            stations: {
              order: number
              content: string
              anchorVisual: string
              association?: string
              x: number
              y: number
              linkedNodeId: string
            }[]
            imageUrl: string
            sourceNodeIds: string[]
          }
        | { ok: false; error: string }
      >
      docToMindmap: (payload: {
        apiKey: string
        model: string
        documentText: string
        documentFilename: string
      }) => Promise<
        | {
            ok: true
            nodes: {
              id: string
              type: string
              position: { x: number; y: number }
              data: Record<string, unknown>
            }[]
            edges: { id: string; source: string; target: string; type: string }[]
            documentTitle: string
          }
        | { ok: false; error: string }
      >
      listProviders: () => Promise<{
        chat: { id: string; displayName: string; models: { id: string; displayName: string }[] }[]
        image: { id: string; displayName: string }[]
      }>
      urlToDataUrl: (payload: { url: string }) => Promise<
        _FsResult<{ dataUrl: string }>
      >
    }
    file: {
      importDocument: () => Promise<
        | { ok: true; data: { docId: string; filename: string; content: string; filePath: string } }
        | { ok: false; error: string }
      >
      open: () => Promise<
        | { ok: true; data: { filePath: string; data: unknown } }
        | { ok: false; error: string }
      >
      save: (payload: {
        filePath: string | null
        data: unknown
      }) => Promise<{ ok: true; data: { filePath: string } } | { ok: false; error: string }>
      saveAs: (payload: {
        data: unknown
      }) => Promise<{ ok: true; data: { filePath: string } } | { ok: false; error: string }>
      recentList: () => Promise<{ filePath: string; title: string; lastOpenedAt: string }[]>
    }
    workspace: {
      openDirectory: () => Promise<
        | {
            ok: true
            data: {
              workspacePath: string
              files: { filePath: string; name: string; lastModifiedAt: string }[]
            }
          }
        | { ok: false; error: string }
      >
      createDirectory: (payload: { name: string }) => Promise<
        | {
            ok: true
            data: {
              workspacePath: string
              files: { filePath: string; name: string; lastModifiedAt: string }[]
            }
          }
        | { ok: false; error: string }
      >
      createFile: (payload: { workspacePath: string; name: string; data: unknown }) => Promise<
        | { ok: true; data: { filePath: string; data: unknown } }
        | { ok: false; error: string }
      >
      listFiles: (payload: { workspacePath: string }) => Promise<
        | { ok: true; data: { filePath: string; name: string; lastModifiedAt: string }[] }
        | { ok: false; error: string }
      >
      openFilePath: (payload: { filePath: string }) => Promise<
        | { ok: true; data: { filePath: string; data: unknown } }
        | { ok: false; error: string }
      >
      getSession: () => Promise<{
        workspacePath: string | null
        recentWorkspacePaths: string[]
        lastOpenedFilePath: string | null
        restoreLastWorkspaceOnLaunch: boolean
      }>
      switchDirectory: (payload: { workspacePath: string }) => Promise<
        | {
            ok: true
            data: {
              workspacePath: string
              files: { filePath: string; name: string; lastModifiedAt: string }[]
            }
          }
        | { ok: false; error: string }
      >
      listTree: (payload: { workspacePath: string }) => Promise<_FsResult<_WorkspaceTreeEntry[]>>
      createSubfolder: (payload: {
        parentPath: string
        name: string
        workspacePath: string
      }) => Promise<_FsResult<{ path: string }>>
      deleteItem: (payload: {
        targetPath: string
        workspacePath: string
      }) => Promise<_FsResult>
      renameItem: (payload: {
        oldPath: string
        newName: string
        workspacePath: string
      }) => Promise<_FsResult<{ newPath: string }>>
      moveItem: (payload: {
        sourcePath: string
        targetDirPath: string
        workspacePath: string
      }) => Promise<_FsResult<{ newPath: string }>>
    }
    settings: {
      load: () => Promise<{
        apiKey: string
        chatModel: string
        activeProviders: { chat: string; image: string }
        providerConfigs: Record<string, { apiKey: string; baseUrl?: string }>
        editor: { autoSaveIntervalMs: number; maxBackups: number; cachePruneDays: number }
        recentFilesMax: number
        lastWorkspacePath: string | null
        recentWorkspacePaths: string[]
        lastOpenedFilePath: string | null
        restoreLastWorkspaceOnLaunch: boolean
      }>
      update: (partial: Record<string, unknown>) => Promise<void>
    }
    window: {
      minimize: () => Promise<void>
      close: () => Promise<void>
      closeConfirmed: () => Promise<void>
      onBeforeClose: (callback: () => void) => () => void
    }
  }
}
