import type { MindmapYamlNode } from '../../../utils/yamlMindmap.js'
import { normalizeTree } from '../../../utils/yamlMindmap.js'

/**
 * 递归扁平化 MindmapYamlNode 树为 GeneratedNode/GeneratedEdge
 */
export function flattenYamlTree(
  nodes: MindmapYamlNode[],
  parentId: string,
  genId: (prefix: string) => string,
): { nodes: Array<{ id: string; type: 'text'; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; type: string }> } {
  const resultNodes: Array<{ id: string; type: 'text'; data: Record<string, unknown> }> = []
  const resultEdges: Array<{ id: string; source: string; target: string; type: string }> = []

  for (const node of nodes) {
    const nodeId = genId('text')
    const data: Record<string, unknown> = { label: node.label }
    if (node.summary) data.summary = node.summary

    resultNodes.push({
      id: nodeId,
      type: 'text',
      data,
    })
    resultEdges.push({
      id: `e-${parentId}-${nodeId}`,
      source: parentId,
      target: nodeId,
      type: 'smoothstep',
    })

    if (node.children && node.children.length > 0) {
      const sub = flattenYamlTree(node.children, nodeId, genId)
      resultNodes.push(...sub.nodes)
      resultEdges.push(...sub.edges)
    }
  }

  return { nodes: resultNodes, edges: resultEdges }
}

/**
 * 从 sanitizeTreeCandidate 的结果中提取 MindmapYamlNode 根节点
 */
export function extractRootTree(treeCandidate: unknown, fallbackTitle: string): MindmapYamlNode | null {
  if (!treeCandidate || typeof treeCandidate !== 'object') {
    return null
  }

  // Single structured/outline tree
  if ('label' in (treeCandidate as Record<string, unknown>) && typeof (treeCandidate as Record<string, unknown>).label === 'string') {
    return normalizeTree(treeCandidate as MindmapYamlNode, '')
  }

  // Array of trees — wrap in virtual root
  if (Array.isArray(treeCandidate)) {
    const children = treeCandidate
      .filter((item): item is MindmapYamlNode =>
        item !== null && typeof item === 'object' && 'label' in item && typeof (item as Record<string, unknown>).label === 'string',
      )
      .map((item) => normalizeTree(item, ''))

    if (children.length === 0) return null

    return {
      label: fallbackTitle,
      page_range: '',
      children,
    }
  }

  // Single object without label (should not happen after sanitizeTreeCandidate)
  return null
}
