import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'

export interface ContextMenuItem {
  id: string
  label: string
  danger?: boolean
}

export interface NodeTypeDescriptor<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  typeId: string
  displayName: string
  group: 'core' | 'community'
  component: ComponentType<NodeProps>
  propertiesPanel?: ComponentType<{ nodeId: string; data: TData }>
  defaultData: () => TData
  contextMenuItems?: ContextMenuItem[]
  serialize?: (data: TData) => unknown
  deserialize?: (raw: unknown) => TData
  userCreatable: boolean
}
