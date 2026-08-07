import type { WorkspaceState } from '../fs/types.js'
import { DEFAULT_SETTINGS } from '../fs/types.js'
import { DEFAULT_WORKSPACE_STATE } from '../fs/workspace.js'
import type { FileSystemService } from '../fs/index.js'

/** 无用户痕迹的默认工作区：无最近打开文件，视为可安全迁移旧版全局 key。 */
function isDefaultWorkspaceState(state: WorkspaceState): boolean {
  return state.lastOpenedFilePath === null && state.recentFiles.length === 0
}

export async function getWorkspaceSessionForService(service: FileSystemService) {
  const launchResult = await service.appState.getLaunchSession()
  if (!launchResult.ok) {
    return {
      workspacePath: null as string | null,
      workspaceUuid: null as string | null,
      activeSessionIds: {} as Record<string, string>,
      recentWorkspacePaths: [] as string[],
      lastOpenedFilePath: null as string | null,
      restoreLastWorkspaceOnLaunch: DEFAULT_SETTINGS.restoreLastWorkspaceOnLaunch,
    }
  }
  const { workspacePath, recentWorkspacePaths, restoreLastWorkspaceOnLaunch } = launchResult.data

  let lastOpenedFilePath: string | null = null
  let workspaceUuid: string | null = null
  let activeSessionIds: Record<string, string> = {}
  if (workspacePath) {
    const workspaceResult = await service.workspace.load(workspacePath)
    const workspaceState = workspaceResult.ok
      ? workspaceResult.data
      : { ...DEFAULT_WORKSPACE_STATE }
    lastOpenedFilePath = workspaceState.lastOpenedFilePath
    workspaceUuid = workspaceState.workspaceUuid
    activeSessionIds = workspaceState.activeSessionIds

    // One-time migration of legacy workspace-scoped keys from global settings.json.
    // Only seed workspace-local state if it is still all-defaults, then remove the legacy keys.
    if (isDefaultWorkspaceState(workspaceState)) {
      const legacyResult = await service.appState.migrateLegacyWorkspaceState(workspacePath)
      if (legacyResult.ok && legacyResult.data) {
        await service.workspace.migrateLegacyState(workspacePath, legacyResult.data)
        const reloaded = await service.workspace.load(workspacePath)
        if (reloaded.ok) {
          lastOpenedFilePath = reloaded.data.lastOpenedFilePath
          workspaceUuid = reloaded.data.workspaceUuid
          activeSessionIds = reloaded.data.activeSessionIds
        }
      }
    }
  }

  return {
    workspacePath,
    recentWorkspacePaths,
    lastOpenedFilePath,
    workspaceUuid,
    activeSessionIds,
    restoreLastWorkspaceOnLaunch,
  }
}
