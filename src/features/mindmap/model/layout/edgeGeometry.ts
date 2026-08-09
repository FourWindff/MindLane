import { Position } from '@xyflow/react'
import { defaultNodeSize } from '@/shared/lib/nodeSize'

export interface EdgeNodeLike {
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

export interface EdgeGeometryParams {
  sourceNode?: EdgeNodeLike
  targetNode?: EdgeNodeLike
  fallback: EdgeGeometry
}

function resolveHandleX(node: EdgeNodeLike, handlePosition: Position): number {
  const width = node.measured?.width ?? defaultNodeSize(node.type).width
  return handlePosition === Position.Left ? node.position.x : node.position.x + width
}

function resolveHandleY(node: EdgeNodeLike): number {
  const height = node.measured?.height ?? defaultNodeSize(node.type).height
  return node.position.y + height / 2
}

function nodeCenterX(node: EdgeNodeLike): number {
  return node.position.x + (node.measured?.width ?? defaultNodeSize(node.type).width) / 2
}

export function resolveEdgeGeometry({
  sourceNode,
  targetNode,
  fallback,
}: EdgeGeometryParams): EdgeGeometry {
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
    sourceY: sourceNode ? resolveHandleY(sourceNode) : fallback.sourceY,
    targetX: targetNode ? resolveHandleX(targetNode, targetPosition) : fallback.targetX,
    targetY: targetNode ? resolveHandleY(targetNode) : fallback.targetY,
    sourcePosition: sourceNode || targetNode ? sourcePosition : fallback.sourcePosition,
    targetPosition: sourceNode || targetNode ? targetPosition : fallback.targetPosition,
  }
}
