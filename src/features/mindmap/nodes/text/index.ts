import { NodeTypeDescriptor } from '../types'
import { nodeRegistry } from '../registry'
import { TextNodeComponent } from './TextNodeComponent'
import type { TextNodeData } from './types'

class TextDescriptor extends NodeTypeDescriptor<TextNodeData> {
  readonly typeId = 'text'
  readonly component = TextNodeComponent

  serialize(data: TextNodeData) {
    return {
      label: data.label,
      ...(data.palaceId != null && { palaceId: data.palaceId }),
      ...(data.pageRange != null && { pageRange: data.pageRange }),
      ...(data.summary != null && { summary: data.summary }),
      ...(data.side != null && { side: data.side }),
      ...(data.branchIndex != null && { branchIndex: data.branchIndex }),
    }
  }

  deserialize(raw: unknown): TextNodeData {
    return raw as TextNodeData
  }
}

const textDescriptor = new TextDescriptor()

nodeRegistry.register(textDescriptor)
