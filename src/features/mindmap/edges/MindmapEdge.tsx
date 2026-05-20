import { BaseEdge, getSmoothStepPath, useStore, type EdgeProps } from '@xyflow/react'
import { useMemo } from 'react'
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

  // Subscribe to both edges and nodes at the top level for reactive updates
  const { edges, nodes } = useStore((s) => ({ edges: s.edges, nodes: s.nodes }))

  // Memoize sibling computation to avoid recalculating on every render
  const edgePath = useMemo(() => {
    // Build Y-position lookup map for O(1) access during sorting
    const nodeYById = new Map(nodes.map((n) => [n.id, n.position.y]))

    const siblingEdges = edges
      .filter((e) => e.source === source)
      .sort((a, b) => (nodeYById.get(a.target) ?? 0) - (nodeYById.get(b.target) ?? 0))

    const siblingIndex = siblingEdges.findIndex((e) => e.id === id)
    const siblingCount = siblingEdges.length

    const centerX = computeSiblingCenterX(
      sourceX,
      targetX,
      siblingIndex >= 0 ? siblingIndex : 0,
      siblingCount,
    )

    const [path] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      centerX,
    })

    return path
  }, [edges, nodes, source, id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition])

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
