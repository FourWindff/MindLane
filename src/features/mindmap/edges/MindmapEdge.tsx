import { BaseEdge, getBezierPath, getSmoothStepPath, useStore, type EdgeProps } from '@xyflow/react'
import { useMemo } from 'react'
import { computeSiblingCurvature } from './siblingOffset'
import { buildTaperedPath } from './taperedEdge'
import { resolveEdgeGeometry } from '@/features/mindmap/model/layout/edgeGeometry'
import { useMapStyle } from '@/features/mindmap/style/useMapStyle'
import { getEdgeColor, getNodeColor } from '@/features/mindmap/style/colorPalettes'

interface EdgeGradient {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  from: string
  to: string
}

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
  const { edge, colorScheme } = useMapStyle()

  const { edgePath, edgeStroke, taperPath, gradient } = useMemo(() => {
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

    const geometry = resolveEdgeGeometry({
      sourceNode,
      targetNode,
      fallback: { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition },
      connect: edge.connect,
      strokeWidth: edge.strokeWidth,
    })

    let path: string
    let taperPath: string | undefined
    if (edge.path === 'bezier') {
      const curvature = computeSiblingCurvature(siblingIndex >= 0 ? siblingIndex : 0, siblingCount)
      ;[path] = getBezierPath({ ...geometry, curvature })
      if (edge.stroke === 'trunk' && edge.connect === 'side') {
        const baseWidth = Math.max(3, 6 - depth)
        taperPath = buildTaperedPath(geometry, curvature, baseWidth, 1)
      }
    } else if (edge.path === 'smooth-step') {
      ;[path] = getSmoothStepPath({ ...geometry, borderRadius: 8 })
    } else {
      // step / 直角折线
      ;[path] = getSmoothStepPath({ ...geometry, borderRadius: 0 })
    }

    // 极简式（连接下边框）：边颜色从源节点边框色渐变到目标节点边框色，
    // 使两端与节点下边框无缝衔接
    let edgeStroke = stroke
    let gradient: EdgeGradient | undefined
    if (edge.connect === 'bottom' && sourceNode && targetNode) {
      const targetDepth = (targetNode.data?.depth as number | undefined) ?? 0
      const targetBranchIndex = (targetNode.data?.branchIndex as number | undefined) ?? 0
      const gradientId = `mindmap-edge-${id.replace(/[^a-zA-Z0-9]/g, '_')}`
      gradient = {
        id: gradientId,
        x1: geometry.sourceX,
        y1: geometry.sourceY,
        x2: geometry.targetX,
        y2: geometry.targetY,
        from: getNodeColor(colorScheme, depth, branchIndex).nodeBorder,
        to: getNodeColor(colorScheme, targetDepth, targetBranchIndex).nodeBorder,
      }
      edgeStroke = `url(#${gradientId})`
    }

    return { edgePath: path, edgeStroke, taperPath, gradient }
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
    edge,
    colorScheme,
  ])

  return (
    <g>
      {gradient && (
        <defs>
          <linearGradient
            id={gradient.id}
            gradientUnits="userSpaceOnUse"
            x1={gradient.x1}
            y1={gradient.y1}
            x2={gradient.x2}
            y2={gradient.y2}
          >
            <stop offset="0%" stopColor={gradient.from} />
            <stop offset="100%" stopColor={gradient.to} />
          </linearGradient>
        </defs>
      )}
      {taperPath && (
        <path
          d={taperPath}
          className="react-flow__edge-path"
          style={{ fill: edgeStroke, stroke: 'none', shapeRendering: 'auto' }}
        />
      )}
      <BaseEdge
        path={edgePath}
        style={{
          ...style,
          stroke: taperPath ? 'transparent' : edgeStroke,
          strokeWidth: taperPath ? undefined : edge.strokeWidth,
          // 极简式边与节点下边框对齐：关闭像素吸附避免亚像素错位
          ...(edge.connect === 'bottom' ? { shapeRendering: 'auto' as const } : {}),
        }}
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
    </g>
  )
}
