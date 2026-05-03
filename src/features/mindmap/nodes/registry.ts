import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeTypeDescriptor } from './types'

class NodeRegistry {
  private descriptors = new Map<string, NodeTypeDescriptor>()

  register(descriptor: NodeTypeDescriptor<any>): void {
    this.descriptors.set(descriptor.typeId, descriptor as NodeTypeDescriptor)
  }

  get(typeId: string): NodeTypeDescriptor | undefined {
    return this.descriptors.get(typeId)
  }

  toReactFlowNodeTypes(): Record<string, ComponentType<NodeProps>> {
    const result: Record<string, ComponentType<NodeProps>> = {}
    for (const d of this.descriptors.values()) {
      result[d.typeId] = d.component
    }
    return result
  }
}

export const nodeRegistry = new NodeRegistry()
