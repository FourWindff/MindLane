import type { Edge, Node } from '@xyflow/react'
import { DagreLayoutAdapter, type InitialLayoutOptions } from './layout/dagreLayoutAdapter'
import { TreeLayoutAdapter } from './layout/treeLayoutAdapter'
import {
  resolveEdgeGeometry,
  type EdgeGeometry,
  type EdgeGeometryParams,
} from './layout/edgeGeometry'

export type MindmapStructureType = 'logic' | 'mindmap'

class MindmapLayout {
  constructor(
    private initialAdapter: DagreLayoutAdapter,
    private incrementalAdapter: TreeLayoutAdapter,
  ) {}

  initial(nodes: Node[], edges: Edge[], options: InitialLayoutOptions = {}): Node[] {
    return this.initialAdapter.layout(nodes, edges, options)
  }

  reflow(nodes: Node[], edges: Edge[], structureType: MindmapStructureType = 'logic'): Node[] {
    return this.incrementalAdapter.layout(nodes, edges, structureType)
  }

  resolveEdgeGeometry(params: EdgeGeometryParams): EdgeGeometry {
    return resolveEdgeGeometry(params)
  }
}

export type { EdgeGeometry, EdgeGeometryParams, InitialLayoutOptions }

export const mindmapLayout = new MindmapLayout(new DagreLayoutAdapter(), new TreeLayoutAdapter())
