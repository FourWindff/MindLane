import { useEffect } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'

type EdgeTypes = NonNullable<React.ComponentProps<typeof ReactFlow>['edgeTypes']>

export function HiddenThumbnailFlow({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  onInit,
}: {
  nodes: Node[]
  edges: Edge[]
  nodeTypes: NodeTypes
  edgeTypes: EdgeTypes
  onInit: React.MutableRefObject<ReactFlowInstance | null>
}) {
  const rf = useReactFlow()

  useEffect(() => {
    onInit.current = rf
    return () => { onInit.current = null }
  }, [rf, onInit])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      panOnDrag={false}
      panOnScroll={false}
      selectionOnDrag={false}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="rgba(0, 0, 0, 0.15)" />
    </ReactFlow>
  )
}
