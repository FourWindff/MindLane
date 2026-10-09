import { describe, it, expect } from 'vitest'
import { createEmptyFile } from './fileFormat'

describe('MindLaneFile metadata', () => {
  it('createEmptyFile produces file with a stable UUID', () => {
    const first = createEmptyFile('First')
    const second = createEmptyFile('Second')

    expect(first.metadata.fileUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(second.metadata.fileUuid).not.toBe(first.metadata.fileUuid)
  })
})
