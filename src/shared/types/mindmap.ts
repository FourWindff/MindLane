import { DocumentNodeData } from '@/features/mindmap/nodes/document'
import { PalaceNodeData } from '@/features/mindmap/nodes/palace'
import { TopicNodeData } from '@/features/mindmap/nodes/topic'
import type { Node } from '@xyflow/react'

export type TopicNodeType = Node<TopicNodeData, 'topic'>
export type PalaceNodeType = Node<PalaceNodeData, 'palace'>
export type DocumentNodeType = Node<DocumentNodeData, 'document'>

export type MindLaneNodeType = TopicNodeType | PalaceNodeType | DocumentNodeType
