import { PalaceNodeData } from '@/features/mindmap/nodes/palace'
import { TextNodeData } from '@/features/mindmap/nodes/text'
import type { Node } from '@xyflow/react'

export type TextNodeType = Node<TextNodeData, 'text'>
export type PalaceNodeType = Node<PalaceNodeData, 'palace'>

export type MindLaneNodeType = TextNodeType | PalaceNodeType
