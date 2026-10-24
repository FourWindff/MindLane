import type { WorkspaceState } from '../fs/types.js'
import { DEFAULT_SETTINGS } from '../fs/types.js'
import { DEFAULT_WORKSPACE_STATE } from '../fs/workspace.js'
import type { FileSystemService } from '../fs/index.js'
import type { InternalStateStore } from '../store/internalStore.js'

/** Default workspace with no user traces: no file was ever opened, so migrating the legacy global keys is safe. */
function isDefaultWorkspaceState(state: WorkspaceState): boolean {
  return state.lastOpenedFilePath === null
}

/**
 * Workspace session payload for the renderer. Active sessions are read from
 * the internal state store only; there is no `state.json` copy to fall back to.
 * The file identity index is not part of this payload: the capsule bar gets its
 * paths from the single capsule query (`chat.listCapsuleFiles`).
 */
export async function getWorkspaceSessionForService(
  service: FileSystemService,
  stateStore: InternalStateStore | null = null,
) {
  const launchResult = await service.appState.getLaunchSession()
  if (!launchResult.ok) {
    return {
      workspacePath: null as string | null,
      activeSessionIds: {} as Record<string, string>,
      recentWorkspacePaths: [] as string[],
      lastOpenedFilePath: null as string | null,
      restoreLastWorkspaceOnLaunch: DEFAULT_SETTINGS.restoreLastWorkspaceOnLaunch,
    }
  }
  const { workspacePath, recentWorkspacePaths, restoreLastWorkspaceOnLaunch } = launchResult.data

  let lastOpenedFilePath: string | null = null
  let activeSessionIds: Record<string, string> = {}
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

    lastOpenedFilePath = workspaceState.lastOpenedFilePath
    if (stateStore && workspaceState.workspaceUuid) {
      activeSessionIds = Object.fromEntries(
        stateStore
          .listActiveSessions(workspaceState.workspaceUuid)
          .map((row) => [row.fileUuid, row.sessionId]),
      )
    }
  }

  return {
    workspacePath,
    recentWorkspacePaths,
    lastOpenedFilePath,
    activeSessionIds,
    restoreLastWorkspaceOnLaunch,
  }
}

/**
 * Persist one file's active session. The store is the only write: there is no
 * second copy to mirror and no mirror failure to tolerate.
 */
export async function persistActiveSessionForService(
  service: FileSystemService,
  stateStore: InternalStateStore | null,
  workspacePath: string,
  fileUuid: string,
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspaceState = await service.workspace.load(workspacePath)
  if (!workspaceState.ok) return workspaceState
  if (!workspaceState.data.workspaceUuid) {
    return { ok: false, error: 'Workspace is missing a stable identity' }
  }
  if (!stateStore) {
    return { ok: false, error: 'Internal state store is unavailable' }
  }

  stateStore.setActiveSession(workspaceState.data.workspaceUuid, fileUuid, sessionId)
  return { ok: true }
}
