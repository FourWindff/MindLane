/**
 * AbortSignal 工具集。
 *
 * 信号合流与可中断睡眠直接用平台实现（`AbortSignal.any` / `AbortSignal.timeout` /
 * `node:timers/promises` 的 `setTimeout`）；本模块只保留平台没有的那一件：
 * `raceWithAbort` —— 给任意 Promise 包一层取消能力。
 */

export class TimeoutError extends Error {
  constructor(message = '操作超时') {
    super(message)
    this.name = 'TimeoutError'
  }
}

class AbortError extends Error {
  constructor(message = '操作已取消') {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * 让任意 Promise 可被取消。signal abort 后 reject AbortError。
 * 注意：这只是让等待方"放弃"等待，底层任务是否真的停下来取决于它本身是否监听 signal。
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
