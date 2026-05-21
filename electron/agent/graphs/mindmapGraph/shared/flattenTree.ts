import { normalizeTree, type MindmapYamlNode } from '../../../utils/yamlMindmap.js'
import type { GeneratedNode, GeneratedEdge } from '../../../state.js'

export function flattenYamlTree(
  nodes: MindmapYamlNode[],
  parentId: string,
  genId: (prefix: string) => string,
): { nodes: GeneratedNode[]; edges: GeneratedEdge[] } {
  const resultNodes: GeneratedNode[] = []
  const resultEdges: GeneratedEdge[] = []

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

export function extractRootTree(treeCandidate: unknown, fallbackTitle: string): MindmapYamlNode | null {
  if (!treeCandidate || typeof treeCandidate !== 'object') {
    return null
  }

  const record = treeCandidate as Record<string, unknown>

  if ('label' in record && typeof record.label === 'string') {
    return normalizeTree(treeCandidate as MindmapYamlNode, '')
  }

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

  return null
}
