export type PalaceNodeData = {
  label: string
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
