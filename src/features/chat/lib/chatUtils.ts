import type { Node } from '@xyflow/react'
import { isTextNodeData, isPalaceNodeData } from '@/shared/lib/fileFormat'

export type ContextNodeInfo = {
  id: string
  type: 'text' | 'palace'
  label: string
  /** 根节点链（root → … → 本节点，compact 轮次状态用，帮助模型定位） */
  chain?: string[]
  /** 直接子节点（compact 子树，深度 1） */
  children?: ContextNodeInfo[]
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

/**
 * 组装 compact 轮次状态信息：根节点链 + 直接子树（深度 1）。
 * 模型因此知道选中节点在图中的位置，无需调用 readMindmap 就能做兄弟定位。
 */
export function extractNodeInfoCompact(
  node: Node,
  nodes: Node[],
  edges: Array<{ source: string; target: string }>,
): ContextNodeInfo {
  const info = extractNodeInfo(node)

  // 根节点链：沿父边向上走到根
  const parents = new Map(edges.map((e) => [e.target, e.source]))
  const chain: string[] = [node.id]
  let current = parents.get(node.id)
  while (current) {
    chain.unshift(current)
    current = parents.get(current)
  }
  if (chain[0] !== 'root' && !parents.has(node.id)) {
    chain.unshift('root')
  }
  info.chain = chain

  // 直接子节点（compact 子树，深度 1）
  const children = edges
    .filter((e) => e.source === node.id)
    .map((e) => nodes.find((n) => n.id === e.target))
    .filter((n): n is Node => Boolean(n))
    .map((child) => extractNodeInfo(child))
  if (children.length > 0) info.children = children

  return info
}

export function toolDisplayName(name: string): string {
  const map = {
    generateMindmap: '生成思维导图',
    generateMindmapFragment: '生成思维导图片段',
    generatePalace: '生成记忆宫殿',
    readMindmap: '读取导图',
    listWorkspaceFiles: '查看工作区文件',
    insertXmlFragment: '插入 XML 片段',
    updateMindmapNode: '更新节点',
    moveMindmapNode: '移动节点',
    deleteMindmapNode: '删除节点',
  } as const
  return map[name as keyof typeof map] ?? name
}
