import type { Edge, Node } from '@xyflow/react'
import { DagreLayoutAdapter, type InitialLayoutOptions } from './layout/dagreLayoutAdapter'
import { TreeLayoutAdapter } from './layout/treeLayoutAdapter'
import { DEFAULT_STYLE } from '@/features/mindmap/style/presets'
import type { VisualVariant } from '@/features/mindmap/style/types'

export type MindmapStructureType = 'logic' | 'mindmap'

class MindmapLayout {
  constructor(
    private initialAdapter: DagreLayoutAdapter,
    private incrementalAdapter: TreeLayoutAdapter,
  ) {}

  initial(nodes: Node[], edges: Edge[], options: InitialLayoutOptions = {}): Node[] {
    return this.initialAdapter.layout(nodes, edges, options)
  }

  reflow(
    nodes: Node[],
    edges: Edge[],
    structureType: MindmapStructureType = 'logic',
    visualVariant: VisualVariant = DEFAULT_STYLE.visualVariant,
  ): Node[] {
    return this.incrementalAdapter.layout(nodes, edges, structureType, visualVariant)
  }
}

export type { InitialLayoutOptions }

export const mindmapLayout = new MindmapLayout(new DagreLayoutAdapter(), new TreeLayoutAdapter())
