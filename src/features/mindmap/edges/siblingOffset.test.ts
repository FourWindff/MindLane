import { describe, it, expect } from 'vitest'
import { computeSiblingCurvature } from './siblingOffset'

describe('computeSiblingCurvature', () => {
  it('a single edge returns the default curvature', () => {
    expect(computeSiblingCurvature(0, 1)).toBe(0.25)
  })

  it('two edges are distributed symmetrically around the default curvature', () => {
    expect(computeSiblingCurvature(0, 2)).toBeCloseTo(0.23, 6)
    expect(computeSiblingCurvature(1, 2)).toBeCloseTo(0.27, 6)
  })

  it('three edges are centered on the default curvature', () => {
    expect(computeSiblingCurvature(0, 3)).toBeCloseTo(0.21, 6)
    expect(computeSiblingCurvature(1, 3)).toBeCloseTo(0.25, 6)
    expect(computeSiblingCurvature(2, 3)).toBeCloseTo(0.29, 6)
  })

  it('five edges are distributed evenly', () => {
    expect(computeSiblingCurvature(0, 5)).toBeCloseTo(0.17, 6)
    expect(computeSiblingCurvature(1, 5)).toBeCloseTo(0.21, 6)
    expect(computeSiblingCurvature(2, 5)).toBeCloseTo(0.25, 6)
    expect(computeSiblingCurvature(3, 5)).toBeCloseTo(0.29, 6)
    expect(computeSiblingCurvature(4, 5)).toBeCloseTo(0.33, 6)
  })
})
