export const BASE_CURVATURE = 0.25
export const CURVATURE_SPREAD = 0.04

export function computeSiblingCurvature(
  siblingIndex: number,
  siblingCount: number,
): number {
  if (siblingCount <= 1) return BASE_CURVATURE
  const totalSpread = (siblingCount - 1) * CURVATURE_SPREAD
  return BASE_CURVATURE - totalSpread / 2 + siblingIndex * CURVATURE_SPREAD
}
