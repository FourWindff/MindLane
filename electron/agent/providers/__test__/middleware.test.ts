import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  withRetry,
  withTimeout,
  isRetryableError,
  computeBackoffDelay,
  linkSignals,
  sleepWithAbort,
  TimeoutError,
  RetryExhaustedError,
} from '../middleware/index.js'

describe('isRetryableError', () => {
  it('treats TimeoutError as retryable', () => {
    expect(isRetryableError(new TimeoutError())).toBe(true)
  })

  it('treats network TypeError as retryable', () => {
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true)
  })

  it('treats HTTP 5xx as retryable', () => {
    expect(isRetryableError(new Error('上游异常 HTTP 503'))).toBe(true)
    expect(isRetryableError(new Error('HTTP 500 internal'))).toBe(true)
  })

  it('treats HTTP 429 as retryable', () => {
    expect(isRetryableError(new Error('HTTP 429 too many requests'))).toBe(true)
  })

  it('treats HTTP 4xx (except 429) as non-retryable', () => {
    expect(isRetryableError(new Error('HTTP 401 unauthorized'))).toBe(false)
    expect(isRetryableError(new Error('HTTP 400 bad request'))).toBe(false)
    expect(isRetryableError(new Error('HTTP 404 not found'))).toBe(false)
  })

  it('treats unknown errors as non-retryable', () => {
    expect(isRetryableError(new Error('some random failure'))).toBe(false)
    expect(isRetryableError('string error')).toBe(false)
  })
})

describe('computeBackoffDelay', () => {
  it('follows exponential growth bounded by maxDelay', () => {
    const opt = { baseDelay: 500, maxDelay: 8000, jitterMs: 0 }
    expect(computeBackoffDelay(0, opt)).toBe(500)
    expect(computeBackoffDelay(1, opt)).toBe(1000)
    expect(computeBackoffDelay(2, opt)).toBe(2000)
    expect(computeBackoffDelay(10, opt)).toBe(8000) // capped
  })
})

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries on retryable errors and eventually succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockRejectedValueOnce(new Error('HTTP 502'))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(op, { baseDelay: 10, maxDelay: 100, jitterMs: 0 })
    const expectation = expect(promise).resolves.toBe('ok')
    await vi.runAllTimersAsync()
    await expectation
    expect(op).toHaveBeenCalledTimes(3)
  })

  it('stops immediately on non-retryable error', async () => {
    const err = new Error('HTTP 401 unauthorized')
    const op = vi.fn().mockRejectedValue(err)

    const promise = withRetry(op, { baseDelay: 10, maxDelay: 100, jitterMs: 0 })
    const expectation = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError)
    await vi.runAllTimersAsync()
    await expectation
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('exhausts retries and throws RetryExhaustedError', async () => {
    const op = vi.fn().mockRejectedValue(new Error('HTTP 500'))

    const promise = withRetry(op, { maxRetries: 2, baseDelay: 10, maxDelay: 100, jitterMs: 0 })
    const expectation = expect(promise).rejects.toBeInstanceOf(RetryExhaustedError)
    await vi.runAllTimersAsync()
    await expectation
    expect(op).toHaveBeenCalledTimes(3) // 1 + 2 retries
  })
})

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves before timeout', async () => {
    const promise = withTimeout(async () => 'value', 1000)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('value')
  })

  it('rejects with TimeoutError when operation overshoots', async () => {
    const promise = withTimeout(
      async (signal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
      100,
    )
    // attach catch handler synchronously to avoid unhandled rejection
    const expectation = expect(promise).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(150)
    await expectation
  })

  it('honors external abort signal', async () => {
    const controller = new AbortController()
    const promise = withTimeout(
      async (signal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
      5_000,
      { signal: controller.signal },
    )
    const expectation = expect(promise).rejects.toThrow('user cancel')
    controller.abort(new Error('user cancel'))
    await expectation
  })
})

describe('linkSignals', () => {
  it('aborts when any input aborts', () => {
    const a = new AbortController()
    const b = new AbortController()
    const linked = linkSignals([a.signal, b.signal])
    expect(linked.signal.aborted).toBe(false)
    b.abort(new Error('b cancelled'))
    expect(linked.signal.aborted).toBe(true)
    linked.cleanup()
  })

  it('aborts immediately if any input is already aborted', () => {
    const a = new AbortController()
    a.abort(new Error('already'))
    const linked = linkSignals([a.signal])
    expect(linked.signal.aborted).toBe(true)
  })
})

describe('sleepWithAbort', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after delay', async () => {
    const promise = sleepWithAbort(100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects when aborted mid-sleep', async () => {
    const controller = new AbortController()
    const promise = sleepWithAbort(1_000, controller.signal)
    controller.abort(new Error('cancel sleep'))
    await expect(promise).rejects.toThrow('cancel sleep')
  })

  it('rejects immediately if signal already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('preaborted'))
    await expect(sleepWithAbort(100, controller.signal)).rejects.toThrow('preaborted')
  })
})
