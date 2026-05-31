import { describe, it, expect } from 'vitest'
import { createEmptyFile } from '../fileFormat'

describe('MindLaneFile tags', () => {
  it('createEmptyFile should produce file with tags optional', () => {
    const file = createEmptyFile('Test')
    expect(file.metadata.tags).toBeUndefined()
  })
})
