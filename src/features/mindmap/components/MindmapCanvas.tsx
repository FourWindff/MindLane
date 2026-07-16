import type { ComponentProps } from 'react'
import {
  Controls,
  ReactFlow,
  SelectionMode,
  useOnSelectionChange,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react'

type ReactFlowProps = ComponentProps<typeof ReactFlow>
type EdgeTypes = NonNullable<ReactFlowProps['edgeTypes']>

export interface MindmapCanvasProps {
  nodes: Node[]
  edges: Edge[]
  nodeTypes: NodeTypes
  edgeTypes: EdgeTypes
  disabled: boolean
  onNodesChange?: ReactFlowProps['onNodesChange']
  onEdgesChange?: ReactFlowProps['onEdgesChange']
  onConnect?: ReactFlowProps['onConnect']
  onNodeClick?: ReactFlowProps['onNodeClick']
  onPaneContextMenu?: ReactFlowProps['onPaneContextMenu']
  onNodeContextMenu?: ReactFlowProps['onNodeContextMenu']
  onSelectionContextMenu?: ReactFlowProps['onSelectionContextMenu']
  onEdgeContextMenu?: ReactFlowProps['onEdgeContextMenu']
  onMoveEnd?: ReactFlowProps['onMoveEnd']
  onInit?: ReactFlowProps['onInit']
  onSelectionChange: (nodes: Node[]) => void
}

export function MindmapCanvas({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  disabled,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onNodeContextMenu,
  onSelectionContextMenu,
  onEdgeContextMenu,
  onMoveEnd,
  onInit,
  onSelectionChange,
}: MindmapCanvasProps) {
  useOnSelectionChange({ onChange: ({ nodes: selectedNodes }) => onSelectionChange(selectedNodes) })

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={disabled ? undefined : onNodesChange}
      onEdgesChange={disabled ? undefined : onEdgesChange}
      onConnect={disabled ? undefined : onConnect}
      onNodeClick={onNodeClick}
      onPaneContextMenu={(event) => event.preventDefault()}
      onNodeContextMenu={onNodeContextMenu}
      onSelectionContextMenu={onSelectionContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      selectionOnDrag
      panOnDrag={[1]}
      selectionMode={SelectionMode.Partial}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={!disabled}
      nodesConnectable={!disabled}
      elementsSelectable={!disabled}
      onMoveEnd={onMoveEnd}
      onInit={onInit}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
