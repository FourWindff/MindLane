/**
 * Run context carried through AsyncLocalStorage.
 *
 * A Runner wraps the whole stream execution in runWithStreamId, so any log
 * line emitted downstream (graph nodes, provider metering, middleware) can
 * auto-attach the streamId without threading it through every signature.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

interface RunContext {
  streamId?: string
}

const storage = new AsyncLocalStorage<RunContext>()

export function runWithStreamId<T>(streamId: string, fn: () => T): T {
  return storage.run({ streamId }, fn)
}

export function currentStreamId(): string | undefined {
  return storage.getStore()?.streamId
}

/** `stream_ab12cd34-...` → `ab12cd34` */
export function shortStreamId(streamId: string): string {
  return streamId.replace(/^stream_/, '').slice(0, 8)
}
