import { describe, expect, it } from 'vitest'
import { assertEntryName } from '../entryName.js'

describe('assertEntryName', () => {
  it('returns the trimmed name', () => {
    expect(assertEntryName('  notes.mindlane  ', '文件名称')).toBe('notes.mindlane')
  })

  it('rejects an empty name with the labelled message', () => {
    expect(() => assertEntryName('   ', '仓库名称')).toThrowError('仓库名称不能为空')
  })

  it.each(['.', '..', 'a/b', 'a\\b'])('rejects %j as illegal', (name) => {
    expect(() => assertEntryName(name, '文件名称')).toThrowError('文件名称包含非法字符')
  })
})
