/**
 * withTimeout - 统一超时控制中间件。
 *
 * 把任意 async 操作包一层超时：`AbortSignal.timeout` 负责超时，外部 signal 经
 * `AbortSignal.any` 接力；超时与外部取消都表现为 operation 收到的 signal 触发。
 *
 * 注意：被包裹的 operation 必须能感知 signal，否则只是调用方提前 reject。
 */

import { TimeoutError, raceWithAbort } from './abort.js'

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
  const parent = options.signal ?? null
  // 没有超时约束时退化为带 signal 的直通调用。
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
      throw new TimeoutError(options.timeoutMessage ?? `操作超时（${timeoutMs}ms）`)
    }
    throw err
  }
}

export { TimeoutError }
