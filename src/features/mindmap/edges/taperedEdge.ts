import { Position } from '@xyflow/react'
import type { EdgeGeometry } from '@/features/mindmap/model/layout/edgeGeometry'

function bezierControlOffset(distance: number, curvature: number): number {
  return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance)
}

function cubicPoint(
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x3: number,
  y3: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return { x: a * x0 + b * c1x + c * c2x + d * x3, y: a * y0 + b * c1y + c * c2y + d * y3 }
}

// 把贝塞尔曲线采样成“树干”：源端粗、目标端细的填充多边形（与 getBezierPath 用同一控制点）。
export function buildTaperedPath(
  { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeGeometry,
  curvature: number,
  widthStart: number,
  widthEnd: number,
  segments = 24,
): string {
  const c1x =
    sourcePosition === Position.Right
      ? sourceX + bezierControlOffset(targetX - sourceX, curvature)
      : sourceX - bezierControlOffset(sourceX - targetX, curvature)
  const c2x =
    targetPosition === Position.Left
      ? targetX - bezierControlOffset(targetX - sourceX, curvature)
      : targetX + bezierControlOffset(sourceX - targetX, curvature)

  const forward: string[] = []
  const backward: string[] = []
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    pts.push(cubicPoint(sourceX, sourceY, c1x, sourceY, c2x, targetY, targetX, targetY, t))
  }
  for (let i = 0; i <= segments; i++) {
    const p = pts[i]!
    const q = pts[i < segments ? i + 1 : i - 1]!
    const t = i / segments
    const halfW = (widthStart + (widthEnd - widthStart) * t) / 2
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
    const nx = -(q.y - p.y) / len
    const ny = (q.x - p.x) / len
    forward.push(`${p.x + nx * halfW},${p.y + ny * halfW}`)
    backward.push(`${p.x - nx * halfW},${p.y - ny * halfW}`)
  }
  return `M${forward.join(' L')} L${backward.reverse().join(' L')} Z`
}
