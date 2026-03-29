import { NodeTypeDescriptor } from '../types'
import type { PalaceNodeData } from '@/shared/lib/fileFormat'
import { PalaceNodeComponent } from './PalaceNodeComponent'

class PalaceDescriptor extends NodeTypeDescriptor<PalaceNodeData> {
  readonly typeId = 'palace'
  readonly displayName = '记忆宫殿'
  readonly group = 'core' as const
  readonly component = PalaceNodeComponent
  readonly userCreatable = false
  readonly contextMenuItems = [
    { id: 'view-palace', label: '查看宫殿详情' },
    { id: 'regenerate', label: '重新生成图片' },
  ]

  defaultData(): PalaceNodeData {
    return { label: '', imageUrl: '', stations: [], sourceNodeIds: [] }
  }

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

export const palaceDescriptor = new PalaceDescriptor()
