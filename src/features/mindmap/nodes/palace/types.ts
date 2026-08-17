export type PalaceNodeData = {
  label: string
  /** 内嵌图片资源 id（<assets> 节）；迁移期下载失败的旧文件保留 imageUrl */
  assetId?: string
  imageUrl: string
  stations: PalaceStation[]
  sourceNodeIds: string[]
  expanded?: boolean
  generating?: boolean
}

export type PalaceStation = {
  order: number
  content: string
  anchorVisual: string
  association?: string
  x: number
  y: number
  linkedNodeId: string
}
