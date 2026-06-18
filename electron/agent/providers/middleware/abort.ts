/**
 * AbortSignal 工具集。
 *
 * - linkSignals: 合并多个外部 AbortSignal，任一触发则汇合的 controller 也 abort。
 * - createTimeoutSignal: 基于 setTimeout 生成一个会自动 abort 的 signal，可与外部 signal 联动。
 * - raceWithAbort: 给任意 Promise 包一层取消能力（被 abort 后立刻 reject AbortError）。
 * - sleepWithAbort: 可被中断的睡眠，用来替代裸 setTimeout 轮询间隔。
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

type LinkedAbort = {
  signal: AbortSignal
  cleanup: () => void
}

/**
 * 把多个 signal 合并为一个：任意一个 abort 都会触发合并 signal abort。
 * 返回 cleanup 来移除监听，避免长链路下的内存泄漏。
 */
export function linkSignals(signals: Array<AbortSignal | undefined | null>): LinkedAbort {
  const controller = new AbortController()
  const active = signals.filter((s): s is AbortSignal => !!s)

  // 任一已经 aborted -> 直接 abort
  for (const s of active) {
    if (s.aborted) {
      controller.abort(s.reason)
      return { signal: controller.signal, cleanup: () => {} }
    }
  }

  const listeners: Array<{ signal: AbortSignal; handler: () => void }> = []
  for (const s of active) {
    const handler = () => controller.abort(s.reason)
    s.addEventListener('abort', handler, { once: true })
    listeners.push({ signal: s, handler })
  }

  const cleanup = () => {
    for (const { signal, handler } of listeners) {
      signal.removeEventListener('abort', handler)
    }
  }

  return { signal: controller.signal, cleanup }
}

/**
 * 在 timeoutMs 后会自动 abort 的 signal；也可以接力外部 signal。
 * 返回值带 cleanup（清定时器与监听）。
 */
export function createTimeoutSignal(
  timeoutMs: number,
  parent?: AbortSignal | null,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()

  if (parent?.aborted) {
    controller.abort(parent.reason)
    return { signal: controller.signal, cleanup: () => {} }
  }

  const timer = setTimeout(() => {
    controller.abort(new TimeoutError(`操作超时（${timeoutMs}ms）`))
  }, timeoutMs)

  let parentHandler: (() => void) | null = null
  if (parent) {
    parentHandler = () => controller.abort(parent.reason)
    parent.addEventListener('abort', parentHandler, { once: true })
  }

  const cleanup = () => {
    clearTimeout(timer)
    if (parent && parentHandler) {
      parent.removeEventListener('abort', parentHandler)
    }
  }

  return { signal: controller.signal, cleanup }
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

/**
 * 可被 abort 的 sleep；signal abort 后立刻 reject AbortError。
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(toAbortError(signal.reason))
      return
    }
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = signal
      ? () => {
          clearTimeout(timer)
          reject(toAbortError(signal.reason))
        }
      : null
    if (signal && onAbort) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new AbortError(reason)
  return new AbortError()
}
