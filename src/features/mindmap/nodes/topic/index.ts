import type { NodeTypeDescriptor } from '../types'
import type { TopicNodeData } from '@/shared/lib/fileFormat'
import { TopicNodeComponent } from './TopicNodeComponent'

export const topicDescriptor: NodeTypeDescriptor<TopicNodeData> = {
  typeId: 'topic',
  displayName: '主题',
  group: 'core',
  component: TopicNodeComponent,
  defaultData: () => ({ label: '新主题' }),
  userCreatable: true,
  contextMenuItems: [
    { id: 'add-child', label: '添加子主题' },
    { id: 'add-sibling', label: '添加同级' },
  ],
}
