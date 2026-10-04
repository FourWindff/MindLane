/**
 * withTimeout - unified timeout-control middleware.
 *
 * Wrap any async operation with a timeout: `AbortSignal.timeout` owns the
 * timeout and an external signal is chained in via `AbortSignal.any`; both a
 * timeout and an external cancel surface as the signal the operation receives
 * firing.
 *
 * Note: the wrapped operation must observe the signal, otherwise this only makes
 * the caller reject early.
 */

import { TimeoutError, raceWithAbort } from './abort.js'

type WithTimeoutOptions = {
  /** External AbortSignal, can be chained with the timeout */
  signal?: AbortSignal | null
  /** Error message thrown on timeout (used only as the TimeoutError message) */
  timeoutMessage?: string
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  options: WithTimeoutOptions = {},
): Promise<T> {
  const parent = options.signal ?? null
  // Without a timeout constraint this degrades to a pass-through call that still carries a signal.
  const timeoutSignal =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null
  const signal = timeoutSignal
    ? parent
      ? AbortSignal.any([timeoutSignal, parent])
      : timeoutSignal
    : (parent ?? new AbortController().signal)

  try {
    return await raceWithAbort(operation(signal), signal)
  } catch (err) {
    if (timeoutSignal?.aborted) {
      throw new TimeoutError(options.timeoutMessage ?? `operation timed out (${timeoutMs}ms)`)
    }
    throw err
  }
}

export { TimeoutError }
