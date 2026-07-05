/**
 * withTimeout - 统一超时控制中间件。
 *
 * 把任意 async 操作包一层超时：
 * - 在 timeoutMs 后用 TimeoutError abort 内部 signal；
 * - 也可以接力外部 signal（外部取消会传递到内部）；
 * - 操作完成（成功或失败）后清理定时器避免泄漏。
 *
 * 注意：被包裹的 operation 必须能感知 signal，否则只是调用方提前 reject。
 */

import { createTimeoutSignal, TimeoutError, raceWithAbort } from './abort.js'

type WithTimeoutOptions = {
  /** 外部 AbortSignal，可与超时联动 */
  signal?: AbortSignal | null
  /** 超时时抛出的错误消息（仅用作 TimeoutError 的 message） */
  timeoutMessage?: string
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  options: WithTimeoutOptions = {},
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    // 没有超时约束时退化为带 signal 的直通调用。
    const controller = new AbortController()
    let parentHandler: (() => void) | null = null
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason)
      } else {
        parentHandler = () => controller.abort(options.signal!.reason)
        options.signal.addEventListener('abort', parentHandler, { once: true })
      }
    }
    try {
      return await operation(controller.signal)
    } finally {
      if (options.signal && parentHandler) {
        options.signal.removeEventListener('abort', parentHandler)
      }
    }
  }

  const { signal, cleanup } = createTimeoutSignal(timeoutMs, options.signal ?? null)
  try {
    return await raceWithAbort(operation(signal), signal)
  } catch (err) {
    if (signal.aborted && signal.reason instanceof TimeoutError) {
      throw new TimeoutError(options.timeoutMessage ?? signal.reason.message)
    }
    throw err
  } finally {
    cleanup()
  }
}

export { TimeoutError }
