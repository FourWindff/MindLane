import type { WorkspaceState } from '../fs/types.js'
import { DEFAULT_SETTINGS } from '../fs/types.js'
import { DEFAULT_WORKSPACE_STATE } from '../fs/workspace.js'
import type { FileSystemService } from '../fs/index.js'

/** Default workspace with no user traces: no file was ever opened, so migrating the legacy global keys is safe. */
function isDefaultWorkspaceState(state: WorkspaceState): boolean {
  return state.lastOpenedFilePath === null
}

/** Workspaces whose session file index has already been pruned (once per process, so getSession does not write to disk every time). */
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

    // Prune the session file index once on restore, dropping entries whose path no longer exists.
    // Runs only on the first restore of each workspace: getSession is called frequently
    // while running (on every file switch), and repeated pruning would write to disk and could
    // race with rename/move mapping updates, wrongly deleting a new path that has not been
    // written back yet.
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
