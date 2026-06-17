/**
 * withRetry - 指数退避重试中间件。
 *
 * 规则：
 * - 最多重试 maxRetries 次（默认 3 次，总调用次数 = 1 + maxRetries）。
 * - 指数退避：delay = min(baseDelay * 2^attempt, maxDelay) + jitter。
 * - 可重试错误：HTTP 5xx、429、网络错误（fetch 抛 TypeError）、AbortError（timeout 导致）。
 * - 不可重试错误：认证 4xx（除 429 外）、其他明确客户端错误。
 */

import { TimeoutError, sleepWithAbort } from './abort.js'

export type RetryOptions = {
  /** 最多重试次数（默认 3） */
  maxRetries?: number
  /** 初始退避间隔（默认 500ms） */
  baseDelay?: number
  /** 最大退避间隔（默认 8000ms） */
  maxDelay?: number
  /** jitter 范围（默认 200ms） */
  jitterMs?: number
  /** 自定义可重试判定 */
  isRetryable?: (err: unknown) => boolean
}

export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
    public readonly attempts: number,
  ) {
    super(message)
    this.name = 'RetryExhaustedError'
  }
}

/**
 * 判断一个错误是否属于"可重试"类别。
 * 可重试：HTTP 5xx、429、网络错误（TypeError）、TimeoutError、AbortError。
 * 不可重试：4xx（除 429 外）。
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true
  if (err instanceof TypeError) return true

  if (err instanceof Error) {
    const name = err.name
    if (name === 'AbortError' || name === 'TimeoutError') return true

    const msg = err.message.toLowerCase()
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
      return true
    }

    // 从消息中提取 HTTP 状态码，如 "HTTP 503"、"HTTP 429"
    const match = err.message.match(/\bHTTP\s+(\d{3})/i)
    if (match) {
      const status = Number(match[1])
      if (status >= 500 || status === 429) return true
      if (status >= 400 && status < 500) return false
    }
  }

  // 默认保守策略：未知错误不重试
  return false
}

/**
 * 指数退避 + jitter 计算。
 */
export function computeBackoffDelay(attempt: number, options: Required<Pick<RetryOptions, 'baseDelay' | 'maxDelay' | 'jitterMs'>>): number {
  const exponential = Math.min(options.baseDelay * Math.pow(2, attempt), options.maxDelay)
  const jitter = Math.random() * options.jitterMs
  return exponential + jitter
}

/**
 * 包装一个异步操作，失败时按策略重试。
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3
  const baseDelay = options.baseDelay ?? 500
  const maxDelay = options.maxDelay ?? 8000
  const jitterMs = options.jitterMs ?? 200
  const shouldRetry = options.isRetryable ?? isRetryableError

  let lastErr: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (err) {
      lastErr = err
      if (attempt >= maxRetries || !shouldRetry(err)) {
        break
      }
      const delay = computeBackoffDelay(attempt, { baseDelay, maxDelay, jitterMs })
      await sleepWithAbort(delay)
    }
  }

  const attempts = maxRetries + 1
  throw new RetryExhaustedError(
    `重试 ${attempts} 次后仍失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    lastErr,
    attempts,
  )
}
