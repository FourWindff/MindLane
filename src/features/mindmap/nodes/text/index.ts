import { NodeTypeDescriptor } from '../types'
import { TextNodeComponent } from './TextNodeComponent'

export type TextNodeData = {
  label: string
  palaceId?: string
  pageRange?: string
  summary?: string
  justAdded?: boolean
  exiting?: boolean
  editing?: boolean
  processing?: boolean
}
class TextDescriptor extends NodeTypeDescriptor<TextNodeData> {
  readonly typeId = 'text'
  readonly component = TextNodeComponent

  serialize(data: TextNodeData) {
    return {
      label: data.label,
      ...(data.palaceId != null && { palaceId: data.palaceId }),
      ...(data.pageRange != null && { pageRange: data.pageRange }),
      ...(data.summary != null && { summary: data.summary }),
    }
  }

  deserialize(raw: unknown): TextNodeData {
    return raw as TextNodeData
  }
}

export const textDescriptor = new TextDescriptor()
