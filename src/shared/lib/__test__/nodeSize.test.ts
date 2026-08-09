import { describe, expect, it } from 'vitest'
import { defaultNodeSize } from '../nodeSize'

describe('defaultNodeSize', () => {
  it('returns the regular node size for text and unknown types', () => {
    expect(defaultNodeSize('text')).toEqual({ width: 160, height: 40 })
    expect(defaultNodeSize('unknown')).toEqual({ width: 160, height: 40 })
    expect(defaultNodeSize(undefined)).toEqual({ width: 160, height: 40 })
  })

  it('returns the palace node size for palace nodes', () => {
    expect(defaultNodeSize('palace')).toEqual({ width: 260, height: 200 })
  })
})
