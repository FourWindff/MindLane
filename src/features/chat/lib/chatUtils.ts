import type { Node } from '@xyflow/react'
import type { TextNodeData, PalaceNodeData } from '@/shared/lib/fileFormat'

export type ContextNodeInfo = {
  id: string
  type: 'text' | 'palace'
  label: string
  extra?: Record<string, unknown>
}

function isKnownNodeType(type: string | undefined): type is 'text' | 'palace' {
  return type === 'text' || type === 'palace'
}

/**
 * Extracts a normalized info object from a React Flow node,
 * handling both text and palace node types.
 */
export function extractNodeInfo(node: Node): ContextNodeInfo {
  const data = node.data as Record<string, unknown>
  const nodeType = isKnownNodeType(node.type) ? node.type : 'text'

  switch (nodeType) {
    case 'palace': {
      const pd = data as PalaceNodeData
      return {
        id: node.id,
        type: 'palace',
        label: pd.label || node.id,
        extra: {
          stationCount: pd.stations?.length ?? 0,
          sourceNodeIds: pd.sourceNodeIds,
        },
      }
    }
    case 'text': {
      const td = data as TextNodeData
      return {
        id: node.id,
        type: 'text',
        label: td.label || node.id,
      }
    }
    default: {
      // Unknown types are already handled by the type guard above,
      // but this default ensures exhaustiveness at runtime.
      const td = data as TextNodeData
      return {
        id: node.id,
        type: 'text',
        label: td.label || node.id,
      }
    }
  }
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

/**
 * Returns a human-readable Chinese display name for a tool call name.
 * Falls back to the raw name if no mapping exists.
 */
export function toolDisplayName(name: string): string {
  const map = {
    generateMindmap: '生成思维导图',
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
  return (map as Record<string, string>)[name] ?? name
}
