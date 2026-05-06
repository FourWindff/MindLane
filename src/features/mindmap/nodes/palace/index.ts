import { NodeTypeDescriptor } from '../types'

import { PalaceNodeComponent } from './PalaceNodeComponent'
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
class PalaceDescriptor extends NodeTypeDescriptor<PalaceNodeData> {
  readonly typeId = 'palace'
  readonly component = PalaceNodeComponent

  serialize(data: PalaceNodeData) {
    return {
      label: data.label,
      imageUrl: data.imageUrl,
      stations: data.stations,
      sourceNodeIds: data.sourceNodeIds,
    }
  }

  deserialize(raw: unknown): PalaceNodeData {
    return raw as PalaceNodeData
  }
}

export const palaceDescriptor = new PalaceDescriptor()
