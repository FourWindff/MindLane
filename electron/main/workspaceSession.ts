import type { WorkspaceState } from '../fs/types.js'
import { DEFAULT_SETTINGS } from '../fs/types.js'
import { DEFAULT_WORKSPACE_STATE } from '../fs/workspace.js'
import type { FileSystemService } from '../fs/index.js'
import type { InternalStateStore } from '../store/internalStore.js'
import { logger } from '../shared/logger.js'

/** Default workspace with no user traces: no file was ever opened, so migrating the legacy global keys is safe. */
function isDefaultWorkspaceState(state: WorkspaceState): boolean {
  return state.lastOpenedFilePath === null
}

/** Workspaces whose session file index has already been pruned (once per process, so getSession does not write to disk every time). */
const prunedFileUuidPathWorkspaces = new Set<string>()

/**
 * Workspace session payload for the renderer. Active sessions are read from
 * the internal state store only; the `state.json` copy is a rollback mirror
 * written by `persistActiveSessionForService` and is never consulted here.
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
      fileUuidPaths: {} as Record<string, string>,
      recentWorkspacePaths: [] as string[],
      lastOpenedFilePath: null as string | null,
      restoreLastWorkspaceOnLaunch: DEFAULT_SETTINGS.restoreLastWorkspaceOnLaunch,
    }
  }
  const { workspacePath, recentWorkspacePaths, restoreLastWorkspaceOnLaunch } = launchResult.data

  let lastOpenedFilePath: string | null = null
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
    fileUuidPaths = workspaceState.fileUuidPaths
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
    fileUuidPaths,
    restoreLastWorkspaceOnLaunch,
  }
}

/**
 * Persist one file's active session: database first (the read source), then the
 * `state.json` rollback mirror. A mirror failure is logged and never fails the
 * caller, because correctness no longer depends on that file.
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

  stateStore?.setActiveSession(workspaceState.data.workspaceUuid, fileUuid, sessionId)

  const mirror = await service.workspace.setActiveSessionId(workspacePath, fileUuid, sessionId)
  if (!mirror.ok) {
    logger.warn(
      '[workspaceSession] state.json active-session mirror failed (database is authoritative): %s',
      mirror.error,
    )
  }
  return { ok: true }
}
