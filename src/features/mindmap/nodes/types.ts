import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'

export abstract class NodeTypeDescriptor<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  abstract readonly typeId: string
  abstract readonly component: ComponentType<NodeProps>
  abstract serialize(data: TData): unknown
  abstract deserialize(raw: unknown): TData
}
