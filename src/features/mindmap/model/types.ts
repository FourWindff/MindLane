import type { Edge, Node } from '@xyflow/react'

/**
 * 导图在某一时刻的结构快照，仅包含 nodes 与 edges。
 * viewport、selection、样式以及节点的临时 UI 标记均不属于快照。
 */
export interface MindmapSnapshot {
  nodes: Node[]
  edges: Edge[]
}

/**
 * 描述一次结构操作的命令。所有命令都会被 {@link MindmapEditor} 执行并记录历史。
 */
export type MindmapCommand =
  | { type: 'addNode'; node: Node; edge?: Edge }
  | { type: 'updateNode'; nodeId: string; patch: (node: Node) => Node }
  | { type: 'deleteSubtree'; rootId: string }
  | { type: 'moveNode'; nodeId: string; position: { x: number; y: number } }
  | { type: 'addEdge'; edge: Edge }
  | { type: 'removeEdge'; edgeId: string }
  | { type: 'batch'; commands: MindmapCommand[] }

/**
 * 历史中的一条记录，保存执行前的快照、被执行的命令（或命令组）以及时间戳。
 * 撤销时恢复到 `before`；重做时重新执行 `commands`。
 */
export interface MindmapTransaction {
  id: string
  before: MindmapSnapshot
  commands: MindmapCommand[]
  timestamp: number
}

/** 需要从历史快照中剥离的临时 UI 标记。 */
export const TRANSIENT_NODE_DATA_FLAGS = [
  'editing',
  'justAdded',
  'exiting',
  'processing',
  'expanded',
  'generating',
] as const

export type TransientNodeDataFlag = (typeof TRANSIENT_NODE_DATA_FLAGS)[number]
