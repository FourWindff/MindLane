/** 图片节点数据：经 asset 引用内嵌图片（禁用外部 URL）。 */
export type ImageNodeData = {
  /** <assets> 节中的资源 id */
  assetId: string
  alt?: string
  width?: number
  height?: number
  collapsed?: boolean
  justAdded?: boolean
  exiting?: boolean
  /** 布局产物（不落盘，打开时重算） */
  depth?: number
  branchIndex?: number
  side?: 'left' | 'right'
}
