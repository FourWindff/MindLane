import type { ComponentProps } from 'react'
import { Controls, ReactFlow, SelectionMode, useOnSelectionChange, type Node } from '@xyflow/react'

type ReactFlowProps = ComponentProps<typeof ReactFlow>

/** ReactFlow's own props, except the selection callback this wrapper owns. */
type MindmapCanvasProps = Omit<ReactFlowProps, 'onSelectionChange'> & {
  disabled: boolean
  onSelectionChange: (nodes: Node[]) => void
}

export function MindmapCanvas({ disabled, onSelectionChange, ...rest }: MindmapCanvasProps) {
  useOnSelectionChange({ onChange: ({ nodes: selectedNodes }) => onSelectionChange(selectedNodes) })

  return (
    <ReactFlow
      {...rest}
      // onNodesChange stays wired while disabled: dimension measurements must
      // still reach the editor during an AI stream, or edges connect at stale
      // default sizes until a later interaction forces a re-measure. The
      // controller filters out everything but dimensions while aiBusy.
      onEdgesChange={disabled ? undefined : rest.onEdgesChange}
      onConnect={disabled ? undefined : rest.onConnect}
      onPaneContextMenu={(event) => event.preventDefault()}
      selectionOnDrag
      panOnDrag={[1]}
      selectionMode={SelectionMode.Partial}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={!disabled}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
