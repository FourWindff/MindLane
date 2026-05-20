export const SPREAD_PER_EDGE = 8

/**
 * 根据同级 edge 的索引计算分散后的 centerX。
 * 同级 edge 的垂直段在默认 centerX 两侧对称分布，相邻 edge 间隔 SPREAD_PER_EDGE 像素。
 */
export function computeSiblingCenterX(
  sourceX: number,
  targetX: number,
  siblingIndex: number,
  siblingCount: number,
  spreadPerEdge: number = SPREAD_PER_EDGE,
): number {
  const defaultCenterX = (sourceX + targetX) / 2
  if (siblingCount <= 1) return defaultCenterX

  const totalSpread = (siblingCount - 1) * spreadPerEdge
  return defaultCenterX - totalSpread / 2 + siblingIndex * spreadPerEdge
}

export const BASE_CURVATURE = 0.25
export const CURVATURE_SPREAD = 0.04

/**
 * 根据同级 edge 的索引计算 bezier 曲线的 curvature。
 * 同级 edge 的 curvature 在 BASE_CURVATURE 两侧对称分布，相邻 edge 间隔 CURVATURE_SPREAD。
 */
export function computeSiblingCurvature(
  siblingIndex: number,
  siblingCount: number,
): number {
  if (siblingCount <= 1) return BASE_CURVATURE
  const totalSpread = (siblingCount - 1) * CURVATURE_SPREAD
  return BASE_CURVATURE - totalSpread / 2 + siblingIndex * CURVATURE_SPREAD
}
