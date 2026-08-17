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
      // 布局产物（depth/branchIndex/side）不落盘（PRD 2.2），打开时布局重算
      ...(data.collapsed === true && { collapsed: true }),
    }
  }
}

const textDescriptor = new TextDescriptor()

nodeRegistry.register(textDescriptor)
