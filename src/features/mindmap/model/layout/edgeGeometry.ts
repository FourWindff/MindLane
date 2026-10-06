import { Position } from '@xyflow/react'
import { defaultNodeSize } from '@/features/mindmap/model/layout/nodeSize'
import type { ConnectPosition } from '@/features/mindmap/theme/types'

interface EdgeNodeLike {
  type?: string
  position: { x: number; y: number }
  measured?: { width?: number; height?: number }
  sourcePosition?: Position
  data?: Record<string, unknown>
}

export interface EdgeGeometry {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
}

interface EdgeGeometryParams {
  sourceNode?: EdgeNodeLike
  targetNode?: EdgeNodeLike
  fallback: EdgeGeometry
  /** Where the edge connects to the node: side=middle of the side; bottom=bottom border */
  connect?: ConnectPosition
  /** Edge stroke width in bottom mode, used to center the edge line on the node's bottom border */
  strokeWidth?: number
}

function resolveHandleX(node: EdgeNodeLike, handlePosition: Position): number {
  const width = node.measured?.width ?? defaultNodeSize(node.type).width
  switch (handlePosition) {
    case Position.Left:
      return node.position.x
    case Position.Right:
      return node.position.x + width
    default:
      // Top / Bottom: leave from the node's horizontal center
      return nodeCenterX(node)
  }
}

function resolveHandleY(node: EdgeNodeLike, handlePosition: Position): number {
  const height = node.measured?.height ?? defaultNodeSize(node.type).height
  switch (handlePosition) {
    case Position.Top:
      return node.position.y
    case Position.Bottom:
      return node.position.y + height
    default:
      return node.position.y + height / 2
  }
}

function nodeCenterX(node: EdgeNodeLike): number {
  return node.position.x + (node.measured?.width ?? defaultNodeSize(node.type).width) / 2
}

export function resolveEdgeGeometry({
  sourceNode,
  targetNode,
  fallback,
  connect = 'side',
  strokeWidth = 0,
}: EdgeGeometryParams): EdgeGeometry {
  // bottom: the edge leaves horizontally from the node's bottom border; the source/target
  // handles still sit on the side facing the child node
  if (connect === 'bottom') {
    const targetCenterX = targetNode ? nodeCenterX(targetNode) : fallback.targetX
    const sourceCenterX = sourceNode ? nodeCenterX(sourceNode) : fallback.sourceX
    const targetIsLeft = targetCenterX < sourceCenterX
    const sourcePosition = targetIsLeft ? Position.Left : Position.Right
    const targetPosition = targetIsLeft ? Position.Right : Position.Left
    // The stroke is centered on the path, so shift it up by half the stroke width to overlap the
    // edge line with the node's bottom border (the border sits inside the element's bottom box)
    const yOffset = strokeWidth / 2
    return {
      sourceX: sourceNode ? resolveHandleX(sourceNode, sourcePosition) : fallback.sourceX,
      sourceY: sourceNode
        ? resolveHandleY(sourceNode, Position.Bottom) - yOffset
        : fallback.sourceY,
      targetX: targetNode ? resolveHandleX(targetNode, targetPosition) : fallback.targetX,
      targetY: targetNode
        ? resolveHandleY(targetNode, Position.Bottom) - yOffset
        : fallback.targetY,
      sourcePosition,
      targetPosition,
    }
  }

  const depth = (sourceNode?.data?.depth as number | undefined) ?? 0
  const targetCenterX = targetNode ? nodeCenterX(targetNode) : fallback.targetX
  const sourceCenterX = sourceNode ? nodeCenterX(sourceNode) : fallback.sourceX
  const targetIsLeft = targetCenterX < sourceCenterX
  const sourcePosition =
    depth === 0
      ? targetIsLeft
        ? Position.Left
        : Position.Right
      : (sourceNode?.sourcePosition ?? fallback.sourcePosition)
  const targetPosition = targetIsLeft ? Position.Right : Position.Left

  return {
    sourceX: sourceNode ? resolveHandleX(sourceNode, sourcePosition) : fallback.sourceX,
    sourceY: sourceNode ? resolveHandleY(sourceNode, sourcePosition) : fallback.sourceY,
    targetX: targetNode ? resolveHandleX(targetNode, targetPosition) : fallback.targetX,
    targetY: targetNode ? resolveHandleY(targetNode, targetPosition) : fallback.targetY,
    sourcePosition: sourceNode || targetNode ? sourcePosition : fallback.sourcePosition,
    targetPosition: sourceNode || targetNode ? targetPosition : fallback.targetPosition,
  }
}

const BASE_CURVATURE = 0.25
const CURVATURE_SPREAD = 0.04

/** Spreads sibling edge curvature symmetrically around the base value. */
export function computeSiblingCurvature(siblingIndex: number, siblingCount: number): number {
  if (siblingCount <= 1) return BASE_CURVATURE
  const totalSpread = (siblingCount - 1) * CURVATURE_SPREAD
  return BASE_CURVATURE - totalSpread / 2 + siblingIndex * CURVATURE_SPREAD
}
