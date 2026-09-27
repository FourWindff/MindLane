import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NODE_TYPE_DESCRIPTORS, type NodeTypeDescriptor } from './descriptors'

class CanvasNodeRegistry {
  private descriptors: Map<string, NodeTypeDescriptor>

  constructor(descriptors: NodeTypeDescriptor[]) {
    this.descriptors = new Map(descriptors.map((descriptor) => [descriptor.typeId, descriptor]))
  }

  get(typeId: string): NodeTypeDescriptor | undefined {
    return this.descriptors.get(typeId)
  }

  toReactFlowNodeTypes(): Record<string, ComponentType<NodeProps>> {
    return Object.fromEntries(
      Array.from(this.descriptors.values(), (descriptor) => [
        descriptor.typeId,
        descriptor.component,
      ]),
    )
  }
}

export const canvasNodeRegistry = new CanvasNodeRegistry(NODE_TYPE_DESCRIPTORS)
