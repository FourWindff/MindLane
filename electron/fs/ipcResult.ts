import type { IpcResult } from './types.js'

/**
 * Error half of an `IpcResult`. `prefix` keeps the operation context some
 * callers report (`Read failed: …`).
 */
export function fail(error: unknown, prefix?: string): IpcResult<never> {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: prefix ? `${prefix}: ${message}` : message }
}

/** Run `action` and wrap its value or thrown error into an `IpcResult`. */
export async function guard<T>(action: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await action() }
  } catch (e) {
    return fail(e)
  }
}
