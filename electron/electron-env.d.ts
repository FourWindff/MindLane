/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string
    VITE_PUBLIC: string
  }
}

type _WorkspaceState = import('./fs/types').WorkspaceState
type _WorkspaceTreeEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  lastModifiedAt: string
  children?: _WorkspaceTreeEntry[]
  previewUrl?: string
}

type _FsOk<T = void> = T extends void ? { ok: true } : { ok: true; data: T }
type _FsResult<T = void> = _FsOk<T> | { ok: false; error: string }

type _ContextNodeInfo = {
  id: string
  type: 'text' | 'palace'
  label: string
  extra?: Record<string, unknown>
}

type _ChatContext = {
  mindmapSummary?: string
  selectedNodes?: _ContextNodeInfo[]
  filePath?: string
  fileTitle?: string
  hasDocumentOpen?: boolean
  workspacePath?: string
  workspaceFiles?: { name: string; filePath: string }[]
  attachedDocument?: import('../src/shared/lib/fileFormat').DocumentRef
  linkedDocuments?: import('../src/shared/lib/fileFormat').DocumentRef[]
}

type _ChatToolCall = import('../src/shared/lib/fileFormat').ChatToolCall
type _ChatMessage = import('../src/shared/lib/fileFormat').ChatMessage

type _ChatSessionMessagesPayload = {
  workspacePath: string
  messages: _ChatMessage[]
}

type _ChatLoadSessionResult = {
  ok: true
  data: {
    sessionId: string
    messages: _ChatMessage[]
  }
}

type _ChatSaveSessionPayload = _ChatSessionMessagesPayload & {
  sessionId: string
}

type _MindLaneNode = import('../src/shared/lib/fileFormat').MindLaneNode
type _MindLaneEdge = import('../src/shared/lib/fileFormat').MindLaneEdge

type _IndexedDocMeta = {
  id: string
  filename: string
  filePath: string
  indexedAt: string
  chunkCount: number
}

type _IndexProgress = {
  phase: 'loading' | 'splitting' | 'embedding' | 'done' | 'error'
  filename: string
  progress: number
  error?: string
}

type _MindmapGenerationProgress = {
  phase: 'preparing' | 'extracting' | 'merging' | 'finalizing' | 'done' | 'error'
  filename: string
  message?: string
  error?: string
}

interface Window {
  ipcRenderer: import('electron').IpcRenderer
  mindlane?: {
    ai: {
      chatStream: (payload: {
        threadId: string
        message: string
        context?: _ChatContext
      }) => Promise<void>
      stopStream: () => Promise<void>
      onStreamToken: (callback: (token: string) => void) => () => void
      onStreamMessageStart: (callback: () => void) => () => void
      onStreamToolStart: (
        callback: (data: { name: string; input: Record<string, unknown> }) => void,
      ) => () => void
      onStreamToolEnd: (callback: (data: { name: string; output: string }) => void) => () => void
      onStreamEnd: (
        callback: (response: {
          content: string
          messages?: Array<{ role: 'assistant'; content: string; toolCalls?: _ChatToolCall[] }>
          toolCalls?: _ChatToolCall[]
          mindmapData?: {
            nodes: _MindLaneNode[]
            edges: _MindLaneEdge[]
            title: string
          }
        }) => void,
      ) => () => void
      onStreamError: (callback: (error: string) => void) => () => void
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
        | {
            ok: true
            capabilities: string[]
          }
        | { ok: false; error: string }
      >
      urlToDataUrl: (payload: { url: string }) => Promise<_FsResult<{ dataUrl: string }>>
    }
    file: {
      open: () => Promise<
        { ok: true; data: { filePath: string; data: unknown } } | { ok: false; error: string }
      >
      save: (payload: {
        filePath: string | null
        data: unknown
      }) => Promise<{ ok: true; data: { filePath: string } } | { ok: false; error: string }>
      saveAs: (payload: {
        data: unknown
      }) => Promise<{ ok: true; data: { filePath: string } } | { ok: false; error: string }>
      recentList: () => Promise<{ filePath: string; title: string; lastOpenedAt: string }[]>
      saveThumbnail: (payload: {
        filePath: string
        imageData: string
      }) => Promise<{ ok: true; data: { previewUrl: string } } | { ok: false; error: string }>
      selectDocument: () => Promise<
        | {
            ok: true
            data: { path: string; name: string; size: number; mtimeMs: number; sha256: string }
          }
        | { ok: false; error: string }
      >
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
      createFile: (payload: {
        workspacePath: string
        name: string
        data: unknown
      }) => Promise<
        { ok: true; data: { filePath: string; data: unknown } } | { ok: false; error: string }
      >
      listFiles: (payload: {
        workspacePath: string
      }) => Promise<
        | { ok: true; data: { filePath: string; name: string; lastModifiedAt: string }[] }
        | { ok: false; error: string }
      >
      openFilePath: (payload: {
        filePath: string
      }) => Promise<
        { ok: true; data: { filePath: string; data: unknown } } | { ok: false; error: string }
      >
      getSession: () => Promise<{
        workspacePath: string | null
        recentWorkspacePaths: string[]
        lastOpenedFilePath: string | null
        expandedFolderPaths: string[]
        restoreLastWorkspaceOnLaunch: boolean
      }>
      updateState: (
        payload: { workspacePath: string } & Partial<_WorkspaceState>,
      ) => Promise<{ ok: true } | { ok: false; error: string }>
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
      deleteItem: (payload: { targetPath: string; workspacePath: string }) => Promise<_FsResult>
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
    chat: {
      listSessions: (payload: {
        workspacePath: string
        limit?: number
        offset?: number
      }) => Promise<
        | {
            ok: true
            data: {
              sessions: Array<{
                id: string
                title: string
                createdAt: string
                updatedAt: string
                messageCount: number
              }>
            }
          }
        | { ok: false; error: string }
      >
      loadSession: (payload: {
        workspacePath: string
        sessionId: string
      }) => Promise<_ChatLoadSessionResult>
      saveSession: (
        payload: _ChatSaveSessionPayload,
      ) => Promise<{ ok: true } | { ok: false; error: string }>
      deleteSession: (payload: {
        workspacePath: string
        sessionId: string
      }) => Promise<{ ok: true } | { ok: false; error: string }>
    }
    kb: {
      uploadDocuments: () => Promise<_FsResult<{ indexed: _IndexedDocMeta[] }>>
      listDocuments: () => Promise<_IndexedDocMeta[]>
      deleteDocument: (payload: { docId: string }) => Promise<_FsResult>
      onIndexProgress: (callback: (progress: _IndexProgress) => void) => () => void
    }
    mindmap: {
      generateFromFile: (payload?: { filePath?: string | null }) => Promise<
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
      >
      onGenerationProgress: (callback: (progress: _MindmapGenerationProgress) => void) => () => void
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
        restoreLastWorkspaceOnLaunch: boolean
      }>
      update: (partial: Record<string, unknown>) => Promise<void>
    }
    window: {
      minimize: () => Promise<void>
      toggleMaximize: () => Promise<void>
      close: () => Promise<void>
      closeConfirmed: () => Promise<void>
      onBeforeClose: (callback: () => void) => () => void
    }
  }
}
