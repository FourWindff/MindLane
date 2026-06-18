import { NodeTypeDescriptor } from '../types'
import { nodeRegistry } from '../registry'

import { PalaceNodeComponent } from './PalaceNodeComponent'
import type { PalaceNodeData } from './types'

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

const palaceDescriptor = new PalaceDescriptor()

nodeRegistry.register(palaceDescriptor)
