import type { Node } from '@xyflow/react'
import type { TopicNodeData, PalaceNodeData, DocumentNodeData } from '../lib/fileFormat'

export type { TopicNodeData, PalaceNodeData, DocumentNodeData } from '../lib/fileFormat'

export type TopicNodeType = Node<TopicNodeData, 'topic'>
export type PalaceNodeType = Node<PalaceNodeData, 'palace'>
export type DocumentNodeType = Node<DocumentNodeData, 'document'>

export type MindLaneNodeType = TopicNodeType | PalaceNodeType | DocumentNodeType
