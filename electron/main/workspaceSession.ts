import type { WorkspaceState } from '../fs/types.js'
import { DEFAULT_SETTINGS } from '../fs/types.js'
import { DEFAULT_WORKSPACE_STATE } from '../fs/workspace.js'
import type { FileSystemService } from '../fs/index.js'

/** 无用户痕迹的默认工作区：无最近打开文件，视为可安全迁移旧版全局 key。 */
function isDefaultWorkspaceState(state: WorkspaceState): boolean {
  return state.lastOpenedFilePath === null && state.recentFiles.length === 0
}

/** 已执行过会话文件索引 prune 的 workspace（进程内只跑一次，避免每次 getSession 都写盘）。 */
const prunedFileUuidPathWorkspaces = new Set<string>()

export async function getWorkspaceSessionForService(service: FileSystemService) {
  const launchResult = await service.appState.getLaunchSession()
  if (!launchResult.ok) {
    return {
      workspacePath: null as string | null,
      workspaceUuid: null as string | null,
      activeSessionIds: {} as Record<string, string>,
      fileUuidPaths: {} as Record<string, string>,
      recentWorkspacePaths: [] as string[],
      lastOpenedFilePath: null as string | null,
      restoreLastWorkspaceOnLaunch: DEFAULT_SETTINGS.restoreLastWorkspaceOnLaunch,
    }
  }
  const { workspacePath, recentWorkspacePaths, restoreLastWorkspaceOnLaunch } = launchResult.data

  let lastOpenedFilePath: string | null = null
  let workspaceUuid: string | null = null
  let activeSessionIds: Record<string, string> = {}
  let fileUuidPaths: Record<string, string> = {}
  if (workspacePath) {
    const workspaceResult = await service.workspace.load(workspacePath)
    let workspaceState = workspaceResult.ok ? workspaceResult.data : { ...DEFAULT_WORKSPACE_STATE }

    // One-time migration of legacy workspace-scoped keys from global settings.json.
    // Only seed workspace-local state if it is still all-defaults, then remove the legacy keys.
    if (isDefaultWorkspaceState(workspaceState)) {
      const legacyResult = await service.appState.migrateLegacyWorkspaceState(workspacePath)
      if (legacyResult.ok && legacyResult.data) {
        await service.workspace.migrateLegacyState(workspacePath, legacyResult.data)
        const reloaded = await service.workspace.load(workspacePath)
        if (reloaded.ok) workspaceState = reloaded.data
      }
    }

    // 恢复时 prune 一次会话文件索引，剔除路径已不存在的失效条目。
    // 只在每个 workspace 首次恢复时执行：运行中的 getSession 会被
    // 频繁调用（每次切文件），重复 prune 会写盘且可能与改名/移动的
    // 映射更新竞态，把尚未回填的新路径误删。
    if (!prunedFileUuidPathWorkspaces.has(workspacePath)) {
      await service.workspace.pruneFileUuidPaths(workspacePath)
      prunedFileUuidPathWorkspaces.add(workspacePath)
    }
    const finalResult = await service.workspace.load(workspacePath)
    if (finalResult.ok) workspaceState = finalResult.data

    lastOpenedFilePath = workspaceState.lastOpenedFilePath
    workspaceUuid = workspaceState.workspaceUuid
    activeSessionIds = workspaceState.activeSessionIds
    fileUuidPaths = workspaceState.fileUuidPaths
  }

  return {
    workspacePath,
    recentWorkspacePaths,
    lastOpenedFilePath,
    workspaceUuid,
    activeSessionIds,
    fileUuidPaths,
    restoreLastWorkspaceOnLaunch,
  }
}
