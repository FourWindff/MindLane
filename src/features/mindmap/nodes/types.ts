import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'

export interface ContextMenuItem {
  id: string
  label: string
  danger?: boolean
}

export abstract class NodeTypeDescriptor<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  abstract readonly typeId: string
  abstract readonly displayName: string
  abstract readonly group: 'core' | 'community'
  abstract readonly component: ComponentType<NodeProps>
  abstract readonly userCreatable: boolean

  propertiesPanel?: ComponentType<{ nodeId: string; data: TData }>
  contextMenuItems?: ContextMenuItem[]

  abstract defaultData(): TData
  abstract serialize(data: TData): unknown
  abstract deserialize(raw: unknown): TData
}
