import { describe, expect, test } from 'vitest'
import { formatAgentError } from '../utils.js'

describe('formatAgentError', () => {
  test('returns message for plain Error', () => {
    const error = new Error('something broke')
    const result = formatAgentError(error)
    expect(result).toContain('something broke')
    expect(result).toContain('Error: something broke')
  })

  test('includes stack trace when available', () => {
    const error = new Error('stack test')
    const result = formatAgentError(error)
    expect(result).toContain('at')
  })

  test('handles non-Error values', () => {
    expect(formatAgentError('plain string')).toBe('plain string')
    expect(formatAgentError(42)).toBe('42')
    expect(formatAgentError(null)).toBe('null')
    expect(formatAgentError(undefined)).toBe('Unknown error')
  })

  test('handles Error without stack', () => {
    const error = { message: 'no stack' } as Error
    const result = formatAgentError(error)
    expect(result).toBe('no stack')
  })
})
