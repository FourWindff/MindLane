import { create } from 'zustand'
import { createEmptyFile, type MindLaneFile } from '@/shared/lib/fileFormat'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import type { WorkspaceFileEntry, WorkspaceTreeEntry, WorkspaceSessionState } from './types'

interface WorkspaceStore {
  initialized: boolean
  initializing: boolean
  busy: boolean
  workspacePath: string | null
  files: WorkspaceFileEntry[]
  tree: WorkspaceTreeEntry[]
  expandedFolders: Set<string>
  recentWorkspacePaths: string[]
  restoreLastWorkspaceOnLaunch: boolean
  lastError: string | null

  initializeSession: () => Promise<void>
  openWorkspaceDirectory: () => Promise<boolean>
  createWorkspaceDirectory: (name: string) => Promise<boolean>
  switchWorkspace: (workspacePath: string) => Promise<boolean>
  openWorkspaceFile: (filePath: string) => Promise<boolean>
  createMindlaneFile: (name: string, parentPath?: string) => Promise<boolean>
  refreshWorkspaceFiles: (workspacePath?: string | null) => Promise<void>
  refreshTree: () => Promise<void>
  syncAfterFileSaved: (filePath: string) => Promise<void>
  setRestoreLastWorkspaceOnLaunch: (enabled: boolean) => Promise<void>
  toggleFolder: (folderPath: string) => void
  createSubfolder: (parentPath: string, name: string) => Promise<boolean>
  deleteItem: (targetPath: string) => Promise<boolean>
  renameItem: (oldPath: string, newName: string) => Promise<string | null>
  moveItem: (sourcePath: string, targetDirPath: string) => Promise<string | null>
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

function flattenTreeFiles(entries: WorkspaceTreeEntry[]): WorkspaceFileEntry[] {
  const result: WorkspaceFileEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'file') {
      result.push({ filePath: entry.path, name: entry.name, lastModifiedAt: entry.lastModifiedAt })
    }
    if (entry.children) {
      result.push(...flattenTreeFiles(entry.children))
    }
  }
  return result
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

async function listWorkspaceTree(workspacePath: string | null): Promise<WorkspaceTreeEntry[]> {
  if (!workspacePath) return []
  const api = window.mindlane?.workspace
  if (!api) return []
  const result = await api.listTree({ workspacePath })
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

export async function saveCurrentDocumentSilently(): Promise<boolean> {
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
  const tree = await listWorkspaceTree(session.workspacePath)
  useWorkspaceStore.setState({ ...updateWorkspaceState(session, files), tree })
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
  tree: [],
  expandedFolders: new Set<string>(),
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
        tree: [],
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
      const sessionData = session ?? {
        workspacePath: result.data.workspacePath,
        recentWorkspacePaths: [result.data.workspacePath],
        lastOpenedFilePath: null,
        restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
      }
      const tree = await listWorkspaceTree(sessionData.workspacePath)
      useWorkspaceStore.setState({
        ...updateWorkspaceState(sessionData, result.data.files),
        tree,
        expandedFolders: new Set<string>(),
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
      const sessionData = session ?? {
        workspacePath: result.data.workspacePath,
        recentWorkspacePaths: [result.data.workspacePath],
        lastOpenedFilePath: null,
        restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
      }
      const tree = await listWorkspaceTree(sessionData.workspacePath)
      useWorkspaceStore.setState({
        ...updateWorkspaceState(sessionData, result.data.files),
        tree,
        expandedFolders: new Set<string>(),
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
      const sessionData = session ?? {
        workspacePath: result.data.workspacePath,
        recentWorkspacePaths: [result.data.workspacePath],
        lastOpenedFilePath: null,
        restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
      }
      const tree = await listWorkspaceTree(sessionData.workspacePath)
      useWorkspaceStore.setState({
        ...updateWorkspaceState(sessionData, result.data.files),
        tree,
        expandedFolders: new Set<string>(),
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
      return true
    } finally {
      set({ busy: false })
    }
  },

  createMindlaneFile: async (name: string, parentPath?: string) => {
    const workspacePath = get().workspacePath
    if (!workspacePath) {
      set({ lastError: '请先打开工作区' })
      return false
    }
    if (!(await saveCurrentDocumentSilently())) {
      return false
    }

    const targetDir = parentPath ?? workspacePath

    set({ busy: true, lastError: null })
    try {
      const data = createEmptyFile(name.trim())
      const result = await window.mindlane?.workspace.createFile({
        workspacePath: targetDir,
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
      const tree = await listWorkspaceTree(workspacePath)
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
        tree,
      })
      return true
    } finally {
      set({ busy: false })
    }
  },

  refreshWorkspaceFiles: async (workspacePath) => {
    const targetWorkspacePath = workspacePath ?? get().workspacePath
    if (!targetWorkspacePath) {
      set({ files: [], tree: [] })
      return
    }

    try {
      const files = await listWorkspaceFiles(targetWorkspacePath)
      const tree = await listWorkspaceTree(targetWorkspacePath)
      set({ files, tree, workspacePath: targetWorkspacePath })
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  refreshTree: async () => {
    const workspacePath = get().workspacePath
    if (!workspacePath) return
    try {
      const tree = await listWorkspaceTree(workspacePath)
      const files = flattenTreeFiles(tree)
      set({ tree, files })
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  syncAfterFileSaved: async (filePath: string) => {
    const currentWorkspacePath = get().workspacePath
    const session = await loadSessionFromBackend()
    const fallbackSession: WorkspaceSessionState = session ?? {
      workspacePath: currentWorkspacePath ?? dirname(filePath),
      recentWorkspacePaths: [currentWorkspacePath ?? dirname(filePath)],
      lastOpenedFilePath: filePath,
      restoreLastWorkspaceOnLaunch: get().restoreLastWorkspaceOnLaunch,
    }
    if (currentWorkspacePath && fallbackSession.workspacePath !== currentWorkspacePath) {
      fallbackSession.workspacePath = currentWorkspacePath
    }
    const files = await listWorkspaceFiles(fallbackSession.workspacePath)
    const tree = await listWorkspaceTree(fallbackSession.workspacePath)
    set({ ...updateWorkspaceState(fallbackSession, files), tree })
  },

  setRestoreLastWorkspaceOnLaunch: async (enabled: boolean) => {
    set({ restoreLastWorkspaceOnLaunch: enabled })
    await window.mindlane?.settings.update({ restoreLastWorkspaceOnLaunch: enabled })
  },

  toggleFolder: (folderPath: string) => {
    const expanded = new Set(get().expandedFolders)
    if (expanded.has(folderPath)) {
      expanded.delete(folderPath)
    } else {
      expanded.add(folderPath)
    }
    set({ expandedFolders: expanded })
  },

  createSubfolder: async (parentPath: string, name: string) => {
    const workspacePath = get().workspacePath
    if (!workspacePath) {
      set({ lastError: '请先打开工作区' })
      return false
    }

    set({ busy: true, lastError: null })
    try {
      const result = await window.mindlane?.workspace.createSubfolder({
        parentPath,
        name,
        workspacePath,
      })
      if (!result?.ok) {
        set({ lastError: result?.error ?? '创建文件夹失败' })
        return false
      }
      const expanded = new Set(get().expandedFolders)
      expanded.add(parentPath)
      const tree = await listWorkspaceTree(workspacePath)
      set({ tree, expandedFolders: expanded })
      return true
    } finally {
      set({ busy: false })
    }
  },

  deleteItem: async (targetPath: string) => {
    const workspacePath = get().workspacePath
    if (!workspacePath) {
      set({ lastError: '请先打开工作区' })
      return false
    }

    set({ busy: true, lastError: null })
    try {
      const result = await window.mindlane?.workspace.deleteItem({
        targetPath,
        workspacePath,
      })
      if (!result?.ok) {
        set({ lastError: result?.error ?? '删除失败' })
        return false
      }

      const currentFilePath = useMindmapStore.getState().filePath
      if (currentFilePath === targetPath || (currentFilePath && currentFilePath.startsWith(targetPath + '/'))) {
        clearMindLaneFile()
      }

      const tree = await listWorkspaceTree(workspacePath)
      const files = flattenTreeFiles(tree)
      set({ tree, files })
      return true
    } finally {
      set({ busy: false })
    }
  },

  renameItem: async (oldPath: string, newName: string) => {
    const workspacePath = get().workspacePath
    if (!workspacePath) {
      set({ lastError: '请先打开工作区' })
      return null
    }

    set({ busy: true, lastError: null })
    try {
      const result = await window.mindlane?.workspace.renameItem({
        oldPath,
        newName,
        workspacePath,
      })
      if (!result?.ok) {
        set({ lastError: result?.error ?? '重命名失败' })
        return null
      }

      const currentFilePath = useMindmapStore.getState().filePath
      if (currentFilePath === oldPath) {
        useMindmapStore.getState().setFilePath(result.data.newPath)
      }

      const expanded = new Set(get().expandedFolders)
      if (expanded.has(oldPath)) {
        expanded.delete(oldPath)
        expanded.add(result.data.newPath)
        set({ expandedFolders: expanded })
      }

      const tree = await listWorkspaceTree(workspacePath)
      const files = flattenTreeFiles(tree)
      set({ tree, files })
      return result.data.newPath
    } finally {
      set({ busy: false })
    }
  },

  moveItem: async (sourcePath: string, targetDirPath: string) => {
    const workspacePath = get().workspacePath
    if (!workspacePath) {
      set({ lastError: '请先打开工作区' })
      return null
    }

    set({ busy: true, lastError: null })
    try {
      const result = await window.mindlane?.workspace.moveItem({
        sourcePath,
        targetDirPath,
        workspacePath,
      })
      if (!result?.ok) {
        set({ lastError: result?.error ?? '移动失败' })
        return null
      }

      const currentFilePath = useMindmapStore.getState().filePath
      if (currentFilePath === sourcePath) {
        useMindmapStore.getState().setFilePath(result.data.newPath)
      }

      const tree = await listWorkspaceTree(workspacePath)
      const files = flattenTreeFiles(tree)
      set({ tree, files })
      return result.data.newPath
    } finally {
      set({ busy: false })
    }
  },

  clearError: () => set({ lastError: null }),
}))

export async function initializeWorkspaceSession(): Promise<void> {
  await useWorkspaceStore.getState().initializeSession()
}
