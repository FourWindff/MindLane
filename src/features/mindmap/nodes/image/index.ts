import { NodeTypeDescriptor } from '../types'
import { nodeRegistry } from '../registry'
import { ImageNodeComponent } from './ImageNodeComponent'
import type { ImageNodeData } from './types'

class ImageDescriptor extends NodeTypeDescriptor<ImageNodeData> {
  readonly typeId = 'image'
  readonly component = ImageNodeComponent

  serialize(data: ImageNodeData) {
    return {
      assetId: data.assetId,
      ...(data.alt != null && { alt: data.alt }),
      ...(data.width != null && { width: data.width }),
      ...(data.height != null && { height: data.height }),
    }
  }
}

nodeRegistry.register(new ImageDescriptor())
