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
