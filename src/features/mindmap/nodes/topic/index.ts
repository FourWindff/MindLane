import { NodeTypeDescriptor } from '../types'
import { TopicNodeComponent } from './TopicNodeComponent'

export type TopicNodeData = {
  label: string
  palaceId?: string
  pageRange?: string
  summary?: string
  justAdded?: boolean
  exiting?: boolean
  editing?: boolean
  processing?: boolean
}
class TopicDescriptor extends NodeTypeDescriptor<TopicNodeData> {
  readonly typeId = 'topic'
  readonly component = TopicNodeComponent

  serialize(data: TopicNodeData) {
    return {
      label: data.label,
      ...(data.palaceId != null && { palaceId: data.palaceId }),
      ...(data.pageRange != null && { pageRange: data.pageRange }),
      ...(data.summary != null && { summary: data.summary }),
    }
  }

  deserialize(raw: unknown): TopicNodeData {
    return raw as TopicNodeData
  }
}

export const topicDescriptor = new TopicDescriptor()
