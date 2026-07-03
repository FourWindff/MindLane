export type TextNodeData = {
  label: string
  palaceId?: string
  pageRange?: string
  summary?: string
  justAdded?: boolean
  exiting?: boolean
  editing?: boolean
  processing?: boolean
  /** 节点在树中的深度：0=根节点，1=根的直接子节点，以此类推。由布局算法写入。 */
  depth?: number
  /** 所属分支的索引（从根节点第几个子节点的子树中继承）。根节点为 -1。由布局算法写入。 */
  branchIndex?: number
  /** 思维导图布局中节点所在的一侧。由布局算法写入并持久化，保证重新布局时分侧稳定。 */
  side?: 'left' | 'right'
}
