import { describe, expect, it } from 'vitest'
import { displayFileName } from '../displayFileName'

describe('displayFileName', () => {
  it('drops the directory and the extension', () => {
    expect(displayFileName('a/b.mindlane')).toBe('b')
    expect(displayFileName('a\\b.mindlane')).toBe('b')
  })

  it('keeps a name without the extension', () => {
    expect(displayFileName('notes')).toBe('notes')
  })

  it('returns the last segment of a folder path', () => {
    expect(displayFileName('/w/学习笔记')).toBe('学习笔记')
  })
})
