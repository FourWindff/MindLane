import { BaseEdge, getBezierPath, getSmoothStepPath, useStore, type EdgeProps } from '@xyflow/react'
import { useMemo } from 'react'
import { computeSiblingCurvature } from './siblingOffset'
import { resolveMindmapEdgeGeometry } from './edgeGeometry'
import { useMapStyle } from '@/features/mindmap/style/useMapStyle'
import { getEdgeColor } from '@/features/mindmap/style/colorPalettes'

export function MindmapEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
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

  const { edges, nodes } = useStore((s) => ({ edges: s.edges, nodes: s.nodes }))
  const { edgeVariant, colorScheme } = useMapStyle()

  const { edgePath, edgeStroke } = useMemo(() => {
    const nodeYById = new Map(nodes.map((n) => [n.id, n.position.y]))

    const siblingEdges = edges
      .filter((e) => e.source === source)
      .sort((a, b) => (nodeYById.get(a.target) ?? 0) - (nodeYById.get(b.target) ?? 0))

    const siblingIndex = siblingEdges.findIndex((e) => e.id === id)
    const siblingCount = siblingEdges.length

    const sourceNode = nodes.find((n) => n.id === source)
    const targetNode = nodes.find((n) => n.id === target)

    const depth = (sourceNode?.data?.depth as number | undefined) ?? 0
    const branchIndex = (sourceNode?.data?.branchIndex as number | undefined) ?? 0
    const stroke = getEdgeColor(colorScheme, depth, branchIndex)

    const geometry = resolveMindmapEdgeGeometry({
      sourceNode,
      targetNode,
      fallback: { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition },
    })

    let path: string
    if (edgeVariant === 'bezier') {
      const curvature = computeSiblingCurvature(siblingIndex >= 0 ? siblingIndex : 0, siblingCount)
      ;[path] = getBezierPath({ ...geometry, curvature })
    } else if (edgeVariant === 'smooth-step') {
      ;[path] = getSmoothStepPath({ ...geometry, borderRadius: 8 })
    } else {
      // step / 直角折线
      ;[path] = getSmoothStepPath({ ...geometry, borderRadius: 0 })
    }

    return { edgePath: path, edgeStroke: stroke }
  }, [
    edges,
    nodes,
    source,
    target,
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    edgeVariant,
    colorScheme,
  ])

  return (
    <BaseEdge
      path={edgePath}
      style={{ ...style, stroke: edgeStroke }}
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
