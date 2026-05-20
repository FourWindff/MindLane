import { BaseEdge, getSmoothStepPath, useStore, type EdgeProps } from '@xyflow/react'
import { computeSiblingCenterX } from './siblingOffset'

export function MindmapEdge(props: EdgeProps) {
  const {
    id,
    source,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    markerStart,
    interactionWidth,
    label,
    labelStyle,
    labelShowBg,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
  } = props

  const edges = useStore((s) => s.edges)

  // Get all edges originating from the same source node, sorted by target Y position
  const siblingEdges = edges
    .filter((e) => e.source === source)
    .sort((a, b) => {
      const nodes = useStore.getState().nodes
      const nodeA = nodes.find((n) => n.id === a.target)
      const nodeB = nodes.find((n) => n.id === b.target)
      return (nodeA?.position.y ?? 0) - (nodeB?.position.y ?? 0)
    })

  const siblingIndex = siblingEdges.findIndex((e) => e.id === id)
  const siblingCount = siblingEdges.length

  const centerX = computeSiblingCenterX(
    sourceX,
    targetX,
    siblingIndex >= 0 ? siblingIndex : 0,
    siblingCount,
  )

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    centerX,
  })

  return (
    <BaseEdge
      path={edgePath}
      style={style}
      markerEnd={markerEnd}
      markerStart={markerStart}
      interactionWidth={interactionWidth}
      label={label}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
  )
}
