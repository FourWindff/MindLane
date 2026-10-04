import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'
import { TextNodeComponent } from './text/TextNodeComponent'
import { ImageNodeComponent } from './image/ImageNodeComponent'
import { PalaceNodeComponent } from './palace/PalaceNodeComponent'
import type { TextNodeData, ImageNodeData, PalaceNodeData } from '@contracts/nodeData'

/** One node type: React Flow render component + on-disk serialization. */
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
      // Layout artifacts (depth/branchIndex/side) are not persisted (PRD 2.2); layout is recomputed on open
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

/** Node type descriptor table: adding a type here is all the registry needs. */
export const NODE_TYPE_DESCRIPTORS: NodeTypeDescriptor[] = [TEXT, IMAGE, PALACE]
