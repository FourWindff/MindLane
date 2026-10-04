import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'
import { resolveEdgeGeometry } from '@/features/mindmap/model/layout/edgeGeometry'
import { buildTaperedPath } from './taperedEdge'

const fallback = {
  sourceX: 0,
  sourceY: 0,
  targetX: 0,
  targetY: 0,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
}

function node(
  x: number,
  y: number,
  opts: {
    width?: number
    height?: number
    depth?: number
    sourcePosition?: Position
  } = {},
) {
  return {
    position: { x, y },
    measured: { width: opts.width ?? 160, height: opts.height ?? 40 },
    sourcePosition: opts.sourcePosition,
    data: opts.depth !== undefined ? { depth: opts.depth } : {},
  }
}

describe('resolveMindmapEdgeGeometry', () => {
  it('right-hand child: the root leaves from its right edge and the child enters from its left edge', () => {
    const root = node(0, 0, { depth: 0 })
    const child = node(300, -100)

    const g = resolveEdgeGeometry({ sourceNode: root, targetNode: child, fallback })

    expect(g.sourcePosition).toBe(Position.Right)
    expect(g.targetPosition).toBe(Position.Left)
    expect(g.sourceX).toBe(160) // root right edge
    expect(g.targetX).toBe(300) // child left edge
    expect(g.sourceY).toBe(20)
    expect(g.targetY).toBe(-80)
  })

  it('left-hand child: the root leaves from its left edge and the child enters from its right edge (mirror of the right-hand case)', () => {
    const root = node(0, 0, { depth: 0 })
    const child = node(-300, -100)

    const g = resolveEdgeGeometry({ sourceNode: root, targetNode: child, fallback })

    expect(g.sourcePosition).toBe(Position.Left)
    expect(g.targetPosition).toBe(Position.Right)
    expect(g.sourceX).toBe(0) // root left edge
    expect(g.targetX).toBe(-140) // child right edge (-300 + 160)
  })

  it('a non-root node keeps the sourcePosition written by layout; the target entry direction follows the relative position', () => {
    const parent = node(-300, 0, { depth: 1, sourcePosition: Position.Left })
    const child = node(-600, 40)

    const g = resolveEdgeGeometry({
      sourceNode: parent,
      targetNode: child,
      fallback,
    })

    expect(g.sourcePosition).toBe(Position.Left)
    expect(g.targetPosition).toBe(Position.Right)
    expect(g.sourceX).toBe(-300) // parent left edge
    expect(g.targetX).toBe(-440) // child right edge
  })

  it('falls back to the coordinates and directions ReactFlow provides when a node is missing', () => {
    const g = resolveEdgeGeometry({ fallback })

    expect(g).toEqual(fallback)
  })

  it('bottom connection: the edge leaves the node bottom horizontally and the handle faces the child side', () => {
    const root = node(0, 0, { depth: 0, width: 160, height: 40 })
    const child = node(300, 100, { width: 160, height: 40 })

    const g = resolveEdgeGeometry({
      sourceNode: root,
      targetNode: child,
      fallback,
      connect: 'bottom',
      strokeWidth: 2,
    })

    expect(g.sourcePosition).toBe(Position.Right) // faces the right-hand child
    expect(g.targetPosition).toBe(Position.Left)
    expect(g.sourceX).toBe(160) // root right edge
    expect(g.sourceY).toBe(39) // root bottom - half the stroke width (aligned with the bottom border)
    expect(g.targetX).toBe(300) // child left edge
    expect(g.targetY).toBe(139) // child bottom - half the stroke width
  })

  it('bottom connection: leaves from the left when the child is on the left, mirrored', () => {
    const root = node(0, 0, { depth: 0, width: 160, height: 40 })
    const child = node(-300, 100, { width: 160, height: 40 })

    const g = resolveEdgeGeometry({
      sourceNode: root,
      targetNode: child,
      fallback,
      connect: 'bottom',
      strokeWidth: 2,
    })

    expect(g.sourcePosition).toBe(Position.Left)
    expect(g.targetPosition).toBe(Position.Right)
    expect(g.sourceX).toBe(0) // root left edge
    expect(g.sourceY).toBe(39)
    expect(g.targetX).toBe(-140) // child right edge
    expect(g.targetY).toBe(139)
  })
})

describe('buildTaperedPath trunk gradient', () => {
  const horizontal = {
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }

  it('horizontal straight edge: wide at the source (half width 3), narrow at the target (half width 0.5), closed at both ends', () => {
    const d = buildTaperedPath(horizontal, 0.25, 6, 1)

    expect(d.startsWith('M0,3 ')).toBe(true)
    expect(d).toContain(' L100,0.5')
    expect(d).toContain(' L100,-0.5')
    expect(d.endsWith(' Z')).toBe(true)
  })

  it('the refined curve has enough sample points (>16) to avoid sharp corners', () => {
    const d = buildTaperedPath(horizontal, 0.25, 6, 1, 24)
    expect(d.split('L').length).toBeGreaterThan(40)
  })
})
