import { normalizeTree, type MindmapYamlNode } from '../../../utils/yamlMindmap.js'

export function extractRootTree(
  treeCandidate: unknown,
  fallbackTitle: string,
): MindmapYamlNode | null {
  if (!treeCandidate || typeof treeCandidate !== 'object') {
    return null
  }

  const record = treeCandidate as Record<string, unknown>

  if ('label' in record && typeof record.label === 'string') {
    return normalizeTree(treeCandidate as MindmapYamlNode, '')
  }

  if (Array.isArray(treeCandidate)) {
    const children = treeCandidate
      .filter(
        (item): item is MindmapYamlNode =>
          item !== null &&
          typeof item === 'object' &&
          'label' in item &&
          typeof (item as Record<string, unknown>).label === 'string',
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
