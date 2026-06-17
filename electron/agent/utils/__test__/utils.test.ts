import { describe, expect, it } from 'vitest'
import { clamp, messageContentToString, sanitizeFileName } from '../../utils.js'

describe('messageContentToString', () => {
  it('returns string content as-is', () => {
    expect(messageContentToString('hello')).toBe('hello')
  })

  it('joins text blocks from array content', () => {
    const content = [{ text: 'hello ' }, { text: 'world' }]
    expect(messageContentToString(content)).toBe('hello world')
  })

  it('keeps plain string items in array content', () => {
    expect(messageContentToString(['foo', 'bar'])).toBe('foobar')
  })

  it('ignores blocks without a text field', () => {
    expect(messageContentToString([{ type: 'image_url', image_url: 'x' }])).toBe('')
  })

  it('returns empty string for null/undefined', () => {
    expect(messageContentToString(null)).toBe('')
    expect(messageContentToString(undefined)).toBe('')
  })
})

describe('sanitizeFileName', () => {
  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('preserves letters, digits, underscores and hyphens', () => {
    expect(sanitizeFileName('ABC-123_foo')).toBe('ABC-123_foo')
  })

  it('truncates to max length', () => {
    const long = 'a'.repeat(100)
    expect(sanitizeFileName(long).length).toBe(64)
  })
})

describe('clamp', () => {
  it('returns value when inside range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to min when below', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
  })

  it('clamps to max when above', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })
})
