import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'
import { TextNodeComponent } from './text/TextNodeComponent'
import { ImageNodeComponent } from './image/ImageNodeComponent'
import { PalaceNodeComponent } from './palace/PalaceNodeComponent'
import type { TextNodeData } from './text/types'
import type { ImageNodeData } from './image/types'
import type { PalaceNodeData } from './palace/types'

/** 一个节点类型：React Flow 渲染组件 + 落盘序列化。 */
export interface NodeTypeDescriptor<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  typeId: string
  component: ComponentType<NodeProps>
  serialize(data: TData): unknown
}

const TEXT: NodeTypeDescriptor<TextNodeData> = {
  typeId: 'text',
  component: TextNodeComponent,
  serialize(data) {
    return {
      label: data.label,
      ...(data.palaceId != null && { palaceId: data.palaceId }),
      ...(data.pageRange != null && { pageRange: data.pageRange }),
      ...(data.summary != null && { summary: data.summary }),
      // 布局产物（depth/branchIndex/side）不落盘（PRD 2.2），打开时布局重算
      ...(data.collapsed === true && { collapsed: true }),
      ...(data.leftCollapsed === true && { leftCollapsed: true }),
      ...(data.rightCollapsed === true && { rightCollapsed: true }),
    }
  },
}

const IMAGE: NodeTypeDescriptor<ImageNodeData> = {
  typeId: 'image',
  component: ImageNodeComponent,
  serialize(data) {
    return {
      assetId: data.assetId,
      ...(data.alt != null && { alt: data.alt }),
      ...(data.width != null && { width: data.width }),
      ...(data.height != null && { height: data.height }),
    }
  },
}

const PALACE: NodeTypeDescriptor<PalaceNodeData> = {
  typeId: 'palace',
  component: PalaceNodeComponent,
  serialize(data) {
    return {
      label: data.label,
      ...(data.assetId != null && { assetId: data.assetId }),
      imageUrl: data.imageUrl,
      stations: data.stations,
      sourceNodeIds: data.sourceNodeIds,
    }
  },
}

/** 节点类型描述符表：新增类型只需在此加一项，注册表随之就绪。 */
export const NODE_TYPE_DESCRIPTORS: NodeTypeDescriptor[] = [TEXT, IMAGE, PALACE]
