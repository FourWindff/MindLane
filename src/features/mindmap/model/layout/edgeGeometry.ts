import { Position } from '@xyflow/react'
import { defaultNodeSize } from '@/shared/lib/nodeSize'
import type { ConnectPosition } from '@/features/mindmap/style/types'

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
  /** 边连接节点的位置：side=侧边中点；bottom=下边框 */
  connect?: ConnectPosition
  /** bottom 模式下边的描边宽度，用于让边线与节点下边框对齐（居中） */
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
      // Top / Bottom：从节点水平中心出线
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
  // bottom：边从节点下边框（底部）水平引出，源/目标句柄仍为朝向子节点的侧边
  if (connect === 'bottom') {
    const targetCenterX = targetNode ? nodeCenterX(targetNode) : fallback.targetX
    const sourceCenterX = sourceNode ? nodeCenterX(sourceNode) : fallback.sourceX
    const targetIsLeft = targetCenterX < sourceCenterX
    const sourcePosition = targetIsLeft ? Position.Left : Position.Right
    const targetPosition = targetIsLeft ? Position.Right : Position.Left
    // 描边以路径为中心，向上偏移半个线宽，使边线与节点下边框重叠对齐（边框在元素底部 box 内）
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
