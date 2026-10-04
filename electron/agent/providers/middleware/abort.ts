/**
 * AbortSignal toolkit.
 *
 * Signal merging and interruptible sleeps use the platform directly
 * (`AbortSignal.any` / `AbortSignal.timeout` / `setTimeout` from
 * `node:timers/promises`); this module keeps only the one piece the platform
 * lacks: `raceWithAbort` — wraps any Promise with cancellation.
 */

export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

class AbortError extends Error {
  constructor(message = 'Operation canceled') {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * Make any Promise cancellable. Rejects with AbortError once the signal aborts.
 * Note: this only lets the waiter "give up"; whether the underlying task really
 * stops depends on whether it listens to the signal itself.
 */
export function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(toAbortError(signal.reason))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(toAbortError(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new AbortError(reason)
  return new AbortError()
}
