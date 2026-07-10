import type { Edge, Node } from '@xyflow/react'

export interface MindmapLayoutAdapter<TOptions> {
  layout(nodes: Node[], edges: Edge[], options: TOptions): Node[]
}
