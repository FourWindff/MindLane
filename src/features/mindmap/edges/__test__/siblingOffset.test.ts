import { describe, it, expect } from 'vitest'
import {
  computeSiblingCenterX,
  SPREAD_PER_EDGE,
  computeSiblingCurvature,
  BASE_CURVATURE,
  CURVATURE_SPREAD,
} from '../siblingOffset'

describe('computeSiblingCenterX', () => {
  const sourceX = 0
  const targetX = 200
  const defaultCenterX = 100

  it('单条 edge（无同级）应返回默认 centerX', () => {
    expect(computeSiblingCenterX(sourceX, targetX, 0, 1)).toBe(defaultCenterX)
  })

  it('两条 edge 应在默认 centerX 两侧对称分布', () => {
    expect(computeSiblingCenterX(sourceX, targetX, 0, 2)).toBe(defaultCenterX - SPREAD_PER_EDGE / 2)
    expect(computeSiblingCenterX(sourceX, targetX, 1, 2)).toBe(defaultCenterX + SPREAD_PER_EDGE / 2)
  })

  it('三条 edge 应以默认 centerX 为中心对称', () => {
    expect(computeSiblingCenterX(sourceX, targetX, 0, 3)).toBe(defaultCenterX - SPREAD_PER_EDGE)
    expect(computeSiblingCenterX(sourceX, targetX, 1, 3)).toBe(defaultCenterX)
    expect(computeSiblingCenterX(sourceX, targetX, 2, 3)).toBe(defaultCenterX + SPREAD_PER_EDGE)
  })

  it('五条 edge 应均匀分布', () => {
    expect(computeSiblingCenterX(sourceX, targetX, 0, 5)).toBe(defaultCenterX - SPREAD_PER_EDGE * 2)
    expect(computeSiblingCenterX(sourceX, targetX, 1, 5)).toBe(defaultCenterX - SPREAD_PER_EDGE)
    expect(computeSiblingCenterX(sourceX, targetX, 2, 5)).toBe(defaultCenterX)
    expect(computeSiblingCenterX(sourceX, targetX, 3, 5)).toBe(defaultCenterX + SPREAD_PER_EDGE)
    expect(computeSiblingCenterX(sourceX, targetX, 4, 5)).toBe(defaultCenterX + SPREAD_PER_EDGE * 2)
  })

  it('应支持自定义 spreadPerEdge', () => {
    expect(computeSiblingCenterX(sourceX, targetX, 0, 3, 12)).toBe(defaultCenterX - 12)
    expect(computeSiblingCenterX(sourceX, targetX, 1, 3, 12)).toBe(defaultCenterX)
    expect(computeSiblingCenterX(sourceX, targetX, 2, 3, 12)).toBe(defaultCenterX + 12)
  })

  it('sourceX > targetX（反向布局）也应正确计算', () => {
    const revCenter = (200 + 0) / 2 // = 100
    expect(computeSiblingCenterX(200, 0, 0, 3)).toBe(revCenter - SPREAD_PER_EDGE)
    expect(computeSiblingCenterX(200, 0, 1, 3)).toBe(revCenter)
    expect(computeSiblingCenterX(200, 0, 2, 3)).toBe(revCenter + SPREAD_PER_EDGE)
  })
})

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
