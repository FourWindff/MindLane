import { describe, expect, it } from 'vitest'
import { validateUrl, formatUrlFilename, createUrlDocumentRef } from '../urlAttachment'

describe('validateUrl', () => {
  it('accepts and normalizes http/https urls', () => {
    expect(validateUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1')
    expect(validateUrl('http://example.com')).toBe('http://example.com/')
  })

  it('rejects missing or non-http(s) schemes', () => {
    expect(validateUrl('')).toBeNull()
    expect(validateUrl('   ')).toBeNull()
    expect(validateUrl('example.com/path')).toBeNull()
    expect(validateUrl('ftp://example.com')).toBeNull()
    expect(validateUrl('file:///etc/passwd')).toBeNull()
    expect(validateUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('formatUrlFilename', () => {
  it('renders host and path without the protocol', () => {
    expect(formatUrlFilename('https://example.test/article')).toBe('example.test/article')
  })

  it('truncates over-long links with a middle ellipsis', () => {
    const long = `https://example.test/${'x'.repeat(60)}`
    const out = formatUrlFilename(long)
    expect(out).toHaveLength(27)
    expect(out).toContain('…')
    expect(out.endsWith('xxx')).toBe(true)
  })
})

describe('createUrlDocumentRef', () => {
  it('builds a url ref with compact filename and no sha256', () => {
    const ref = createUrlDocumentRef('https://example.test/a')
    expect(ref).toMatchObject({
      type: 'url',
      source: 'https://example.test/a',
      filename: 'example.test/a',
    })
    expect(ref.sha256).toBeUndefined()
    expect(ref.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
