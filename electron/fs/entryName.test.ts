import { describe, expect, it } from 'vitest'
import { assertEntryName } from './entryName.js'

describe('assertEntryName', () => {
  it('returns the trimmed name', () => {
    expect(assertEntryName('  notes.mindlane  ', 'File name')).toBe('notes.mindlane')
  })

  it('rejects an empty name with the labelled message', () => {
    expect(() => assertEntryName('   ', 'Workspace name')).toThrowError(
      'Workspace name cannot be empty',
    )
  })

  it.each(['.', '..', 'a/b', 'a\\b'])('rejects %j as illegal', (name) => {
    expect(() => assertEntryName(name, 'File name')).toThrowError(
      'File name contains illegal characters',
    )
  })
})
