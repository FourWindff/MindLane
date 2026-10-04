/**
 * Run context carried through AsyncLocalStorage.
 *
 * A Runner wraps the whole stream execution in `runWithRunContext`, so any code
 * downstream (graph nodes, tools, provider metering, middleware) can read the
 * run's identity without threading it through every signature: the streamId
 * auto-attaches to log lines, the conversation sessionId stamps
 * conversation-scoped request headers (e.g. OpenCode Go's x-opencode-session),
 * and the workspace identity (path + uuid) is the single source for tools that
 * read workspace files and for memory extraction.
 *
 * The workspace is optional because ephemeral runs (a standalone file outside
 * any workspace) have none; consumers that require it call
 * `requireWorkspaceUuid()` and fail loudly, never silently read an empty value.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/** Workspace identity of one run; both fields come from `.mindlane/state.json`. */
export interface RunWorkspace {
  path: string
  uuid: string
}

export interface RunIdentity {
  streamId: string
  sessionId?: string
  workspace?: RunWorkspace
}

const storage = new AsyncLocalStorage<RunIdentity>()

export function runWithRunContext<T>(identity: RunIdentity, fn: () => T): T {
  return storage.run(identity, fn)
}

export function currentStreamId(): string | undefined {
  return storage.getStore()?.streamId
}

/**
 * Run id for components that only ever execute inside a run (the subgraphs,
 * which the host graph mounts as nodes). A missing context is a contract
 * violation: throwing here beats silently sharing one bucket across unrelated
 * runs (the old `(no-stream)` fallback key).
 */
export function requireStreamId(subject: string): string {
  const streamId = currentStreamId()
  if (!streamId) throw new Error(`${subject} is missing the run context (streamId)`)
  return streamId
}

export function currentSessionId(): string | undefined {
  return storage.getStore()?.sessionId
}

/** Workspace root of the current run, or undefined outside a run / for ephemeral runs. */
export function currentWorkspacePath(): string | undefined {
  return storage.getStore()?.workspace?.path
}

/**
 * Workspace uuid for components that only ever execute inside a workspace run.
 * A missing context is a contract violation (ephemeral runs have no workspace),
 * so this fails loudly instead of reading an empty uuid.
 */
export function requireWorkspaceUuid(subject: string): string {
  const workspaceUuid = storage.getStore()?.workspace?.uuid
  if (!workspaceUuid) throw new Error(`${subject} is missing the workspace context (workspaceUuid)`)
  return workspaceUuid
}

/** `stream_ab12cd34-...` → `ab12cd34` */
export function shortStreamId(streamId: string): string {
  return streamId.replace(/^stream_/, '').slice(0, 8)
}
