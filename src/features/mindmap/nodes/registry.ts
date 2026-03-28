import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { NodeTypeDescriptor, ContextMenuItem } from './types'

class NodeRegistry {
  private descriptors = new Map<string, NodeTypeDescriptor>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(descriptor: NodeTypeDescriptor<any>): void {
    this.descriptors.set(descriptor.typeId, descriptor as NodeTypeDescriptor)
  }

  get(typeId: string): NodeTypeDescriptor | undefined {
    return this.descriptors.get(typeId)
  }

  list(): NodeTypeDescriptor[] {
    return [...this.descriptors.values()]
  }

  listCreatable(): NodeTypeDescriptor[] {
    return this.list().filter((d) => d.userCreatable)
  }

  toReactFlowNodeTypes(): Record<string, ComponentType<NodeProps>> {
    const result: Record<string, ComponentType<NodeProps>> = {}
    for (const d of this.descriptors.values()) {
      result[d.typeId] = d.component
    }
    return result
  }

  getPropertiesPanel(
    typeId: string,
  ): ComponentType<{ nodeId: string; data: Record<string, unknown> }> | undefined {
    const d = this.descriptors.get(typeId)
    return d?.propertiesPanel as
      | ComponentType<{ nodeId: string; data: Record<string, unknown> }>
      | undefined
  }

  getContextMenuItems(typeId: string): ContextMenuItem[] {
    return this.descriptors.get(typeId)?.contextMenuItems ?? []
  }

  serializeNodeData(typeId: string, data: Record<string, unknown>): unknown {
    const d = this.descriptors.get(typeId)
    return d?.serialize ? d.serialize(data) : data
  }

  deserializeNodeData(typeId: string, raw: unknown): Record<string, unknown> {
    const d = this.descriptors.get(typeId)
    return d?.deserialize ? d.deserialize(raw) : (raw as Record<string, unknown>)
  }
}

export const nodeRegistry = new NodeRegistry()
