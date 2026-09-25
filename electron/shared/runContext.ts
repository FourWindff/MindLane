/**
 * Run context carried through AsyncLocalStorage.
 *
 * A Runner wraps the whole stream execution in runWithStreamId, so any log
 * line emitted downstream (graph nodes, provider metering, middleware) can
 * auto-attach the streamId without threading it through every signature.
 * The conversation sessionId rides along so providers can stamp
 * conversation-scoped request headers (e.g. OpenCode Go's x-opencode-session).
 */

import { AsyncLocalStorage } from 'node:async_hooks'

interface RunContext {
  streamId?: string
  sessionId?: string
}

const storage = new AsyncLocalStorage<RunContext>()

export function runWithStreamId<T>(
  streamId: string,
  sessionId: string | undefined,
  fn: () => T,
): T {
  return storage.run({ streamId, sessionId }, fn)
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
  if (!streamId) throw new Error(`${subject}缺少运行上下文（streamId）`)
  return streamId
}

export function currentSessionId(): string | undefined {
  return storage.getStore()?.sessionId
}

/** `stream_ab12cd34-...` → `ab12cd34` */
export function shortStreamId(streamId: string): string {
  return streamId.replace(/^stream_/, '').slice(0, 8)
}
