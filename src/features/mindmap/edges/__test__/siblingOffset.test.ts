import { describe, it, expect } from 'vitest'
import {
  computeSiblingCurvature,
  BASE_CURVATURE,
  CURVATURE_SPREAD,
} from '../siblingOffset'

describe('computeSiblingCurvature', () => {
  it('单条 edge 应返回默认 curvature', () => {
    expect(computeSiblingCurvature(0, 1)).toBe(BASE_CURVATURE)
  })

  it('两条 edge 应在默认 curvature 两侧对称分布', () => {
    expect(computeSiblingCurvature(0, 2)).toBeCloseTo(BASE_CURVATURE - CURVATURE_SPREAD / 2, 6)
    expect(computeSiblingCurvature(1, 2)).toBeCloseTo(BASE_CURVATURE + CURVATURE_SPREAD / 2, 6)
  })

  it('三条 edge 应以默认 curvature 为中心对称', () => {
    expect(computeSiblingCurvature(0, 3)).toBeCloseTo(BASE_CURVATURE - CURVATURE_SPREAD, 6)
    expect(computeSiblingCurvature(1, 3)).toBeCloseTo(BASE_CURVATURE, 6)
    expect(computeSiblingCurvature(2, 3)).toBeCloseTo(BASE_CURVATURE + CURVATURE_SPREAD, 6)
  })

  it('五条 edge 应均匀分布', () => {
    expect(computeSiblingCurvature(0, 5)).toBeCloseTo(BASE_CURVATURE - CURVATURE_SPREAD * 2, 6)
    expect(computeSiblingCurvature(1, 5)).toBeCloseTo(BASE_CURVATURE - CURVATURE_SPREAD, 6)
    expect(computeSiblingCurvature(2, 5)).toBeCloseTo(BASE_CURVATURE, 6)
    expect(computeSiblingCurvature(3, 5)).toBeCloseTo(BASE_CURVATURE + CURVATURE_SPREAD, 6)
    expect(computeSiblingCurvature(4, 5)).toBeCloseTo(BASE_CURVATURE + CURVATURE_SPREAD * 2, 6)
  })
})
