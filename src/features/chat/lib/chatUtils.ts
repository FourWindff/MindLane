import type { Node } from '@xyflow/react'
import { isTextNodeData, isPalaceNodeData } from '@/shared/lib/fileFormat'

export type ContextNodeInfo = {
  id: string
  type: 'text' | 'palace'
  label: string
  extra?: Record<string, unknown>
}

function isKnownNodeType(type: string | undefined): type is 'text' | 'palace' {
  return type === 'text' || type === 'palace'
}

export function extractNodeInfo(node: Node): ContextNodeInfo {
  const nodeType = isKnownNodeType(node.type) ? node.type : 'text'

  switch (nodeType) {
    case 'palace': {
      if (isPalaceNodeData(node.data)) {
        return {
          id: node.id,
          type: 'palace',
          label: node.data.label || node.id,
          extra: {
            stationCount: node.data.stations.length,
            sourceNodeIds: node.data.sourceNodeIds,
          },
        }
      }
      break
    }
    case 'text': {
      if (isTextNodeData(node.data)) {
        return {
          id: node.id,
          type: 'text',
          label: node.data.label || node.id,
        }
      }
      break
    }
  }

  return { id: node.id, type: 'text', label: node.id }
}

const MARKER_RE = /\[(?:INTENT:\w+|PALACE_INPUT:[\s\S]*?|MINDMAP_INPUT:[\s\S]*?|MINDMAP_TITLE:[\s\S]*?)\]/g
const PARTIAL_MARKER_RE = /\[(?:INTENT|PALACE_INPUT|MINDMAP_INPUT|MINDMAP_TITLE)[^\]]*$/i

/**
 * Removes AI protocol markers (e.g. [INTENT:...], [MINDMAP_INPUT:...])
 * from a message string.
 */
export function stripMarkers(text: string): string {
  return text.replace(MARKER_RE, '').replace(PARTIAL_MARKER_RE, '').trim()
}

export function toolDisplayName(name: string): string {
  const map = {
    generateMindmap: '生成思维导图',
    generateMindmapFragment: '生成思维导图片段',
    generatePalace: '生成记忆宫殿',
    getMindmapContext: '读取导图',
    getSelectedNodes: '读取选中节点',
    listWorkspaceFiles: '查看工作区文件',
    addTextNode: '添加文本节点',
    addPalaceNode: '添加记忆宫殿',
    updateMindmapNode: '更新节点',
    deleteMindmapNode: '删除节点',
    batchAddMindmapNodes: '批量添加节点',
  } as const
  return map[name as keyof typeof map] ?? name
}
