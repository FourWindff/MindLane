import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'
import { mindmapLayout } from '@/features/mindmap/model/mindmapLayout'

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
  it('右侧子节点：根节点从右缘出线，子节点从左缘进线', () => {
    const root = node(0, 0, { depth: 0 })
    const child = node(300, -100)

    const g = mindmapLayout.resolveEdgeGeometry({ sourceNode: root, targetNode: child, fallback })

    expect(g.sourcePosition).toBe(Position.Right)
    expect(g.targetPosition).toBe(Position.Left)
    expect(g.sourceX).toBe(160) // 根节点右缘
    expect(g.targetX).toBe(300) // 子节点左缘
    expect(g.sourceY).toBe(20)
    expect(g.targetY).toBe(-80)
  })

  it('左侧子节点：根节点从左缘出线，子节点从右缘进线（与右侧对称）', () => {
    const root = node(0, 0, { depth: 0 })
    const child = node(-300, -100)

    const g = mindmapLayout.resolveEdgeGeometry({ sourceNode: root, targetNode: child, fallback })

    expect(g.sourcePosition).toBe(Position.Left)
    expect(g.targetPosition).toBe(Position.Right)
    expect(g.sourceX).toBe(0) // 根节点左缘
    expect(g.targetX).toBe(-140) // 子节点右缘 (-300 + 160)
  })

  it('非根节点沿用布局写入的 sourcePosition，目标进线方向按相对位置决定', () => {
    const parent = node(-300, 0, { depth: 1, sourcePosition: Position.Left })
    const child = node(-600, 40)

    const g = mindmapLayout.resolveEdgeGeometry({
      sourceNode: parent,
      targetNode: child,
      fallback,
    })

    expect(g.sourcePosition).toBe(Position.Left)
    expect(g.targetPosition).toBe(Position.Right)
    expect(g.sourceX).toBe(-300) // 父节点左缘
    expect(g.targetX).toBe(-440) // 子节点右缘
  })

  it('节点缺失时回退到 ReactFlow 提供的坐标与方向', () => {
    const g = mindmapLayout.resolveEdgeGeometry({ fallback })

    expect(g).toEqual(fallback)
  })
})
