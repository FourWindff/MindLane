import { create } from 'zustand'
import { createEmptyFile, type MindLaneFile } from '@/shared/lib/fileFormat'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import type { WorkspaceFileEntry, WorkspaceSessionState } from './types'

interface WorkspaceStore {
  initialized: boolean
  initializing: boolean
  busy: boolean
  workspacePath: string | null
  files: WorkspaceFileEntry[]
  recentWorkspacePaths: string[]
  restoreLastWorkspaceOnLaunch: boolean
  lastError: string | null

  initializeSession: () => Promise<void>
  openWorkspaceDirectory: () => Promise<boolean>
  createWorkspaceDirectory: (name: string) => Promise<boolean>
  switchWorkspace: (workspacePath: string) => Promise<boolean>
  openWorkspaceFile: (filePath: string) => Promise<boolean>
  createMindlaneFile: (name: string) => Promise<boolean>
  refreshWorkspaceFiles: (workspacePath?: string | null) => Promise<void>
  syncAfterFileSaved: (filePath: string) => Promise<void>
  setRestoreLastWorkspaceOnLaunch: (enabled: boolean) => Promise<void>
  clearError: () => void
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}

function dirname(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  const index = normalizedPath.lastIndexOf('/')
  return index <= 0 ? normalizedPath : normalizedPath.slice(0, index)
}

function updateWorkspaceState(
  session: WorkspaceSessionState,
  files: WorkspaceFileEntry[],
): Pick<
  WorkspaceStore,
  'workspacePath' | 'files' | 'recentWorkspacePaths' | 'restoreLastWorkspaceOnLaunch'
> {
  return {
    workspacePath: session.workspacePath,
    files,
    recentWorkspacePaths: dedupePaths(session.recentWorkspacePaths),
    restoreLastWorkspaceOnLaunch: session.restoreLastWorkspaceOnLaunch,
  }
}

async function loadSessionFromBackend(): Promise<WorkspaceSessionState | null> {
  const api = window.mindlane?.workspace
  if (!api) return null
  return api.getSession()
}

async function listWorkspaceFiles(workspacePath: string | null): Promise<WorkspaceFileEntry[]> {
  if (!workspacePath) return []
  const api = window.mindlane?.workspace
  if (!api) return []
  const result = await api.listFiles({ workspacePath })
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.data
}

function loadMindLaneFile(filePath: string, data: unknown) {
  useMindmapStore.getState().loadFile(filePath, data as MindLaneFile)
}

function clearMindLaneFile() {
  useMindmapStore.getState().clearDocument()
}

async function createUniqueWorkspaceFile(
  workspacePath: string,
  preferredName: string,
  data: MindLaneFile,
): Promise<{ ok: true; filePath: string; data: unknown } | { ok: false; error: string }> {
  const baseName = preferredName.trim() || '未命名'
  for (let index = 0; index < 100; index += 1) {
    const candidateName = index === 0 ? baseName : `${baseName}-${index + 1}`
    const result = await window.mindlane?.workspace.createFile({
      workspacePath,
      name: candidateName,
      data,
    })
    if (result?.ok) {
      return { ok: true, filePath: result.data.filePath, data: result.data.data }
    }
    if (result?.error !== '文件已存在') {
      return { ok: false, error: result?.error ?? '创建文件失败' }
    }
  }

  return { ok: false, error: '自动命名失败，请手动整理工作区中的重名文件' }
}

async function saveCurrentDocumentSilently(): Promise<boolean> {
  const workspaceState = useWorkspaceStore.getState()
  const mindmapState = useMindmapStore.getState()

  if (!mindmapState.hasDocumentOpen || !mindmapState.dirty) {
    return true
  }

  const data = mindmapState.toMindLaneFile()

  if (mindmapState.filePath) {
    const result = await window.mindlane?.file.save({
      filePath: mindmapState.filePath,
      data,
    })
    if (!result?.ok) {
      useWorkspaceStore.setState({ lastError: result?.error ?? '自动保存失败' })
      return false
    }
    mindmapState.setFilePath(result.data.filePath)
    mindmapState.markClean()
    await workspaceState.syncAfterFileSaved(result.data.filePath)
    return true
  }

  const workspacePath = workspaceState.workspacePath
  if (!workspacePath) {
    useWorkspaceStore.setState({ lastError: '当前文件尚未保存，且没有可用工作区用于自动保存' })
    return false
  }

  const createResult = await createUniqueWorkspaceFile(workspacePath, mindmapState.fileTitle, data)
  if (!createResult.ok) {
    useWorkspaceStore.setState({ lastError: createResult.error })
    return false
  }

  loadMindLaneFile(createResult.filePath, createResult.data)
  await workspaceState.syncAfterFileSaved(createResult.filePath)
  return true
}

async function applySessionState(
  session: WorkspaceSessionState,
  options?: { clearMindmapWhenEmpty?: boolean },
): Promise<{
  session: WorkspaceSessionState
  files: WorkspaceFileEntry[]
}> {
  const files = await listWorkspaceFiles(session.workspacePath)
  useWorkspaceStore.setState(updateWorkspaceState(session, files))
  if (!session.workspacePath && options?.clearMindmapWhenEmpty) {
    clearMindLaneFile()
  }
  return { session, files }
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  initialized: false,
  initializing: false,
  busy: false,
  workspacePath: null,
  files: [],
  recentWorkspacePaths: [],
  restoreLastWorkspaceOnLaunch: true,
  lastError: null,

  initializeSession: async () => {
    set({ initializing: true, lastError: null })
    try {
      const session = await loadSessionFromBackend()
      if (!session) {
        set({ initialized: true, initializing: false })
        return
      }

      await applySessionState(session, { clearMindmapWhenEmpty: true })

      if (session.lastOpenedFilePath) {
        const result = await window.mindlane?.workspace.openFilePath({
          filePath: session.lastOpenedFilePath,
        })
        if (result?.ok) {
          loadMindLaneFile(result.data.filePath, result.data.data)
        } else {
          clearMindLaneFile()
        }
      } else {
        clearMindLaneFile()
      }

      set({ initialized: true, initializing: false })
    } catch (error) {
      clearMindLaneFile()
      set({
        initialized: true,
        initializing: false,
        workspacePath: null,
        files: [],
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
  },

  openWorkspaceDirectory: async () => {
    if (!(await saveCurrentDocumentSilently())) {
      return false
    }

    set({ busy: true, lastError: null })
    try {
      const result = await window.mindlane?.workspace.openDirectory()
      if (!result?.ok) {
        if (result?.error && result.error !== '已取消') {
          set({ lastError: result.error })
        }
        return false
      }

      const session = await loadSessionFromBackend()
      useWorkspaceStore.setState({
        ...updateWorkspaceState(
          session ?? {
            workspacePath: result.data.workspacePath,
            recentWorkspacePaths: [result.data.workspacePath],
            lastOpenedFilePath: null,
            restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
          },
          result.data.files,
        ),
      })
      clearMindLaneFile()
      return true
    } finally {
      set({ busy: false })
    }
  },

  createWorkspaceDirectory: async (name: string) => {
    if (!(await saveCurrentDocumentSilently())) {
      return false
    }

    set({ busy: true, lastError: null })
    try {
      const result = await window.mindlane?.workspace.createDirectory({ name })
      if (!result?.ok) {
        if (result?.error && result.error !== '已取消') {
          set({ lastError: result.error })
        }
        return false
      }

      const session = await loadSessionFromBackend()
      useWorkspaceStore.setState({
        ...updateWorkspaceState(
          session ?? {
            workspacePath: result.data.workspacePath,
            recentWorkspacePaths: [result.data.workspacePath],
            lastOpenedFilePath: null,
            restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
          },
          result.data.files,
        ),
      })
      clearMindLaneFile()
      return true
    } finally {
      set({ busy: false })
    }
  },

  switchWorkspace: async (workspacePath: string) => {
    if (!(await saveCurrentDocumentSilently())) {
      return false
    }

    set({ busy: true, lastError: null })
    try {
      const result = await window.mindlane?.workspace.switchDirectory({ workspacePath })
      if (!result?.ok) {
        set({ lastError: result?.error ?? '切换仓库失败' })
        return false
      }

      const session = await loadSessionFromBackend()
      useWorkspaceStore.setState({
        ...updateWorkspaceState(
          session ?? {
            workspacePath: result.data.workspacePath,
            recentWorkspacePaths: [result.data.workspacePath],
            lastOpenedFilePath: null,
            restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
          },
          result.data.files,
        ),
      })
      clearMindLaneFile()
      return true
    } finally {
      set({ busy: false })
    }
  },

  openWorkspaceFile: async (filePath: string) => {
    const currentFilePath = useMindmapStore.getState().filePath
    if (currentFilePath === filePath) return true
    if (!(await saveCurrentDocumentSilently())) {
      return false
    }

    set({ busy: true, lastError: null })
    try {
      const result = await window.mindlane?.workspace.openFilePath({ filePath })
      if (!result?.ok) {
        set({ lastError: result?.error ?? '打开文件失败' })
        return false
      }

      loadMindLaneFile(result.data.filePath, result.data.data)
      const session = await loadSessionFromBackend()
      if (session) {
        const files = await listWorkspaceFiles(session.workspacePath)
        useWorkspaceStore.setState(updateWorkspaceState(session, files))
      }
      return true
    } finally {
      set({ busy: false })
    }
  },

  createMindlaneFile: async (name: string) => {
    const workspacePath = get().workspacePath
    if (!workspacePath) {
      set({ lastError: '请先打开工作区' })
      return false
    }
    if (!(await saveCurrentDocumentSilently())) {
      return false
    }

    set({ busy: true, lastError: null })
    try {
      const data = createEmptyFile(name.trim())
      const result = await window.mindlane?.workspace.createFile({
        workspacePath,
        name,
        data,
      })
      if (!result?.ok) {
        set({ lastError: result?.error ?? '新建文件失败' })
        return false
      }

      loadMindLaneFile(result.data.filePath, result.data.data)
      const session = await loadSessionFromBackend()
      const files = await listWorkspaceFiles(workspacePath)
      set({
        ...updateWorkspaceState(
          session ?? {
            workspacePath,
            recentWorkspacePaths: [workspacePath],
            lastOpenedFilePath: result.data.filePath,
            restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
          },
          files,
        ),
      })
      return true
    } finally {
      set({ busy: false })
    }
  },

  refreshWorkspaceFiles: async (workspacePath) => {
    const targetWorkspacePath = workspacePath ?? get().workspacePath
    if (!targetWorkspacePath) {
      set({ files: [] })
      return
    }

    try {
      const files = await listWorkspaceFiles(targetWorkspacePath)
      set({ files, workspacePath: targetWorkspacePath })
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  syncAfterFileSaved: async (filePath: string) => {
    const session = await loadSessionFromBackend()
    const fallbackSession: WorkspaceSessionState = session ?? {
      workspacePath: dirname(filePath),
      recentWorkspacePaths: [dirname(filePath)],
      lastOpenedFilePath: filePath,
      restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
    }
    const files = await listWorkspaceFiles(fallbackSession.workspacePath)
    set(updateWorkspaceState(fallbackSession, files))
  },

  setRestoreLastWorkspaceOnLaunch: async (enabled: boolean) => {
    set({ restoreLastWorkspaceOnLaunch: enabled })
    await window.mindlane?.settings.update({ restoreLastWorkspaceOnLaunch: enabled })
  },

  clearError: () => set({ lastError: null }),
}))

export async function initializeWorkspaceSession(): Promise<void> {
  await useWorkspaceStore.getState().initializeSession()
}
