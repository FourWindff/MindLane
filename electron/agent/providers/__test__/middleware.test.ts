import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  withRetry,
  withTimeout,
  linkSignals,
  sleepWithAbort,
} from '../middleware/index.js'
import { TimeoutError } from '../middleware/timeout.js'

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

  it('retries TimeoutError, network errors, HTTP 5xx, and HTTP 429', async () => {
    const retryableErrors = [
      new TimeoutError(),
      new TypeError('fetch failed'),
      new Error('上游异常 HTTP 503'),
      new Error('HTTP 500 internal'),
      new Error('HTTP 429 too many requests'),
    ]
    const op = vi
      .fn()
      .mockRejectedValueOnce(retryableErrors[0])
      .mockRejectedValueOnce(retryableErrors[1])
      .mockRejectedValueOnce(retryableErrors[2])
      .mockRejectedValueOnce(retryableErrors[3])
      .mockRejectedValueOnce(retryableErrors[4])
      .mockResolvedValueOnce('ok')

    const promise = withRetry(op, { maxRetries: 5, baseDelay: 10, maxDelay: 100, jitterMs: 0 })
    const expectation = expect(promise).resolves.toBe('ok')
    await vi.runAllTimersAsync()
    await expectation
    expect(op).toHaveBeenCalledTimes(6)
  })

  it('stops immediately on non-retryable error', async () => {
    const err = new Error('HTTP 401 unauthorized')
    const op = vi.fn().mockRejectedValue(err)

    const promise = withRetry(op, { baseDelay: 10, maxDelay: 100, jitterMs: 0 })
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'RetryExhaustedError',
      attempts: 4,
      cause: err,
    })
    await vi.runAllTimersAsync()
    await expectation
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('treats unknown errors and non-429 HTTP 4xx as non-retryable', async () => {
    for (const err of [
      new Error('HTTP 400 bad request'),
      new Error('HTTP 404 not found'),
      new Error('some random failure'),
      'string error',
    ]) {
      const op = vi.fn().mockRejectedValue(err)
      const promise = withRetry(op, { baseDelay: 10, maxDelay: 100, jitterMs: 0 })
      const expectation = expect(promise).rejects.toMatchObject({
        name: 'RetryExhaustedError',
        attempts: 4,
        cause: err,
      })
      await vi.runAllTimersAsync()
      await expectation
      expect(op).toHaveBeenCalledTimes(1)
    }
  })

  it('uses exponential backoff bounded by maxDelay', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(op, { maxRetries: 3, baseDelay: 500, maxDelay: 1_000, jitterMs: 0 })
    const expectation = expect(promise).resolves.toBe('ok')

    expect(op).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(op).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(op).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(op).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(op).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(999)
    expect(op).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(op).toHaveBeenCalledTimes(4)
    await expectation
  })

  it('exhausts retries and throws RetryExhaustedError', async () => {
    const op = vi.fn().mockRejectedValue(new Error('HTTP 500'))

    const promise = withRetry(op, { maxRetries: 2, baseDelay: 10, maxDelay: 100, jitterMs: 0 })
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'RetryExhaustedError',
      attempts: 3,
    })
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
