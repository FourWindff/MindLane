import type { NodeTypeDescriptor } from '../types'
import type { PalaceNodeData } from '@/shared/lib/fileFormat'
import { PalaceNodeComponent } from './PalaceNodeComponent'

export const palaceDescriptor: NodeTypeDescriptor<PalaceNodeData> = {
  typeId: 'palace',
  displayName: '记忆宫殿',
  group: 'core',
  component: PalaceNodeComponent,
  defaultData: () => ({ label: '', imageUrl: '', stations: [], sourceNodeIds: [] }),
  userCreatable: false,
  contextMenuItems: [
    { id: 'view-palace', label: '查看宫殿详情' },
    { id: 'regenerate', label: '重新生成图片' },
  ],
}
