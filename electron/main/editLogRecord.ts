import type { Workspace } from '../fs/workspace.js'
import type { InternalStateStore } from '../store/internalStore.js'

/** Payload sent by the renderer when a user manually commits a node-text edit. */
export interface EditLogAppendPayload {
  workspacePath?: string
  fileUuid?: string
  nodeId?: string
  before?: string
  after?: string
}

export interface EditLogRecorderDeps {
  stateStore: InternalStateStore
  workspace: Pick<Workspace, 'load'>
}

/**
 * Persist one manually committed node-text edit as memory evidence.
 *
 * Only the manual commit path reports edits; AI-driven updates never reach this
 * function, so they are never recorded. Ownership is fixed at load/save time:
 * a file opened through `file.open` outside a workspace has no workspacePath
 * and therefore writes nothing. Returns whether a row was appended.
 */
export async function recordNodeEdit(
  deps: EditLogRecorderDeps,
  payload: EditLogAppendPayload,
  now: number = Date.now(),
): Promise<boolean> {
  const { workspacePath, fileUuid, nodeId, before, after } = payload ?? {}
  if (!workspacePath || !fileUuid || !nodeId || before == null || after == null) return false

  const workspaceState = await deps.workspace.load(workspacePath)
  if (!workspaceState.ok) return false
  const workspaceUuid = workspaceState.data.workspaceUuid
  if (!workspaceUuid) return false

  deps.stateStore.appendEditLog(workspaceUuid, fileUuid, {
    ts: now,
    nodeId,
    before,
    after,
  })
  return true
}
