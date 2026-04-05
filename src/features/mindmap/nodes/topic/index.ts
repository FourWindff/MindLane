import { NodeTypeDescriptor } from '../types'
import { TopicNodeComponent } from './TopicNodeComponent'

export type TopicNodeData = {
  label: string
  palaceId?: string
  justAdded?: boolean
  exiting?: boolean
  [key: string]: unknown
}
class TopicDescriptor extends NodeTypeDescriptor<TopicNodeData> {
  readonly typeId = 'topic'
  readonly displayName = '主题'
  readonly group = 'core' as const
  readonly component = TopicNodeComponent
  readonly userCreatable = true
  readonly contextMenuItems = [
    { id: 'add-child', label: '添加子主题' },
    { id: 'add-sibling', label: '添加同级' },
  ]

  defaultData(): TopicNodeData {
    return { label: '新主题' }
  }

  serialize(data: TopicNodeData) {
    return {
      label: data.label,
      ...(data.palaceId != null && { palaceId: data.palaceId }),
    }
  }

  deserialize(raw: unknown): TopicNodeData {
    return raw as TopicNodeData
  }
}

export const topicDescriptor = new TopicDescriptor()
