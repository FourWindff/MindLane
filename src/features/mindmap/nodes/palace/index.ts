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
      ...(data.assetId != null && { assetId: data.assetId }),
      imageUrl: data.imageUrl,
      stations: data.stations,
      sourceNodeIds: data.sourceNodeIds,
    }
  }
}

const palaceDescriptor = new PalaceDescriptor()

nodeRegistry.register(palaceDescriptor)
