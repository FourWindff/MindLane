import { describe, it, expect } from 'vitest'
import { escapeXml, unescapeXml } from '../escape'
import { normalizeSelfClosingTags, findUnescapedInAttrValues } from '../normalize'

describe('escapeXml', () => {
  it('escapes all 5 characters', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;')
  })

  it('roundtrips through unescapeXml', () => {
    const input = `标题 & 副标题 <tag> "quoted" 'apos'`
    expect(unescapeXml(escapeXml(input))).toBe(input)
  })

  it('leaves base64 safe', () => {
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    expect(escapeXml(base64)).toBe(base64)
  })

  it('unescapes numeric entities', () => {
    expect(unescapeXml('&#65;&#x42;')).toBe('AB')
  })
})

describe('normalizeSelfClosingTags', () => {
  it('expands self-closing custom tags so HTML parsers keep siblings', () => {
    const input = '<node id="a" /><node id="b" />'
    expect(normalizeSelfClosingTags(input)).toBe('<node id="a"></node><node id="b"></node>')
  })

  it('does not touch void html tags', () => {
    const input = '<img src="x" /><br/>'
    expect(normalizeSelfClosingTags(input)).toBe(input)
  })

  it('handles attributes with quoted > inside', () => {
    const input = '<node content="a > b" />'
    expect(normalizeSelfClosingTags(input)).toBe('<node content="a > b"></node>')
  })
})

describe('findUnescapedInAttrValues', () => {
  it('detects raw < inside attribute value (a<b trap)', () => {
    expect(findUnescapedInAttrValues('<node content="a<b" />')).toContain('未转义')
  })

  it('detects raw & inside attribute value', () => {
    expect(findUnescapedInAttrValues('<node content="a & b" />')).toContain('未转义')
  })

  it('accepts properly escaped values', () => {
    expect(findUnescapedInAttrValues('<node content="a &amp; b &lt; c" />')).toBeNull()
  })

  it('accepts single-quoted attributes', () => {
    expect(findUnescapedInAttrValues("<node content='a<b' />")).toContain('未转义')
  })
})
