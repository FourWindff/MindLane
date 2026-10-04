/**
 * withRetry - exponential backoff retry middleware.
 *
 * Rules:
 * - Retry at most maxRetries times (default 3; total calls = 1 + maxRetries).
 * - Exponential backoff: delay = min(baseDelay * 2^attempt, maxDelay) + jitter.
 * - Retryable errors: HTTP 5xx, 429, network errors (fetch throwing TypeError), AbortError (caused by a timeout).
 * - Non-retryable errors: auth 4xx (except 429) and other explicit client errors.
 */

import { TimeoutError } from './abort.js'
import { logger } from '../../../shared/logger.js'

const log = logger.withContext('provider')

type RetryOptions = {
  /** Maximum retry count (default 3) */
  maxRetries?: number
  /** Initial backoff interval (default 500ms) */
  baseDelay?: number
  /** Maximum backoff interval (default 8000ms) */
  maxDelay?: number
  /** Jitter range (default 200ms) */
  jitterMs?: number
  /** Custom retryability predicate */
  isRetryable?: (err: unknown) => boolean
}

class RetryExhaustedError extends Error {
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
 * Decide whether an error belongs to the "retryable" category.
 * Retryable: HTTP 5xx, 429, network errors (TypeError), TimeoutError, AbortError.
 * Non-retryable: 4xx (except 429).
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true
  if (err instanceof TypeError) return true

  if (err instanceof Error) {
    const name = err.name
    if (name === 'AbortError' || name === 'TimeoutError') return true

    const msg = err.message.toLowerCase()
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
      return true
    }

    // Extract the HTTP status code from the message, e.g. "HTTP 503", "HTTP 429"
    const match = err.message.match(/\bHTTP\s+(\d{3})/i)
    if (match) {
      const status = Number(match[1])
      if (status >= 500 || status === 429) return true
      if (status >= 400 && status < 500) return false
    }
  }

  // Default conservative policy: unknown errors are not retried
  return false
}

/**
 * Exponential backoff + jitter.
 */
function computeBackoffDelay(
  attempt: number,
  options: Required<Pick<RetryOptions, 'baseDelay' | 'maxDelay' | 'jitterMs'>>,
): number {
  const exponential = Math.min(options.baseDelay * Math.pow(2, attempt), options.maxDelay)
  const jitter = Math.random() * options.jitterMs
  return exponential + jitter
}

/**
 * Wrap an async operation, retrying on failure according to the policy.
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
      const retryable = shouldRetry(err)
      if (attempt >= maxRetries || !retryable) {
        if (attempt >= maxRetries && retryable) {
          log.error(
            'still failed after %d retries: %s',
            maxRetries + 1,
            err instanceof Error ? err.message : String(err),
          )
        }
        break
      }
      const delay = computeBackoffDelay(attempt, { baseDelay, maxDelay, jitterMs })
      log.warn(
        'attempt %d/%d failed: %s, retrying in %ss',
        attempt + 1,
        maxRetries + 1,
        err instanceof Error ? err.message : String(err),
        (delay / 1000).toFixed(1),
      )
      // Global setTimeout: compatible with the test fake timers, and the backoff sleep needs no cancellation.
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  const attempts = maxRetries + 1
  throw new RetryExhaustedError(
    `still failed after ${attempts} retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    lastErr,
    attempts,
  )
}
