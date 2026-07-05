import { Position } from '@xyflow/react'

const DEFAULT_NODE_WIDTH = 160
const DEFAULT_NODE_HEIGHT = 40

interface EdgeNodeLike {
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

/**
 * 根据 sourcePosition/targetPosition 和节点实测尺寸，计算 handle 坐标。
 *
 * ReactFlow 在节点有多个同类型、无显式 id 的 Handle 时，无法保证路由到
 * sourcePosition/targetPosition 指定的那个 handle，导致 sourceX/targetX
 * 可能取到错误的 handle 坐标。
 * 这里绕过 ReactFlow 的计算，直接从节点 position 和 measured 中还原。
 */
function resolveHandleX(node: EdgeNodeLike, handlePosition: Position): number {
  const w = node.measured?.width ?? DEFAULT_NODE_WIDTH
  return handlePosition === Position.Left ? node.position.x : node.position.x + w
}

function resolveHandleY(node: EdgeNodeLike): number {
  const h = node.measured?.height ?? DEFAULT_NODE_HEIGHT
  return node.position.y + h / 2
}

function nodeCenterX(node: EdgeNodeLike): number {
  return node.position.x + (node.measured?.width ?? DEFAULT_NODE_WIDTH) / 2
}

/**
 * 计算思维导图边两端的坐标与方向。
 *
 * 根据两节点中心的相对 X 位置决定连接方向：
 *   目标在左侧 → source 从左侧出 / target 从右侧进
 *   目标在右侧 → source 从右侧出 / target 从左侧进
 * 根节点（depth === 0）双向出边；其他节点使用布局算法写入的 sourcePosition。
 * 缺少节点信息时回退到 ReactFlow 提供的 fallback 值。
 */
export function resolveMindmapEdgeGeometry(params: {
  sourceNode?: EdgeNodeLike
  targetNode?: EdgeNodeLike
  fallback: EdgeGeometry
}): EdgeGeometry {
  const { sourceNode, targetNode, fallback } = params

  const depth = (sourceNode?.data?.depth as number | undefined) ?? 0

  const targetCenterX = targetNode ? nodeCenterX(targetNode) : fallback.targetX
  const sourceCenterX = sourceNode ? nodeCenterX(sourceNode) : fallback.sourceX
  const targetIsLeft = targetCenterX < sourceCenterX

  // 从 node 对象直接读 sourcePosition，不信任 edge prop（ReactFlow 多 Handle 无 ID 时会取错）
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
