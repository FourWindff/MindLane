import YAML from 'yaml'
import {
  extractYaml,
  normalizeTree,
  sanitizeForestCandidate,
  sanitizeTreeCandidate,
  type MindmapYamlNode,
} from './yamlMindmap.js'

type MindmapYamlValidationMode = 'tree' | 'fragment'

type MindmapYamlValidationResult =
  | { ok: true; tree: MindmapYamlNode }
  | { ok: false; reason: string }

export function validateMindmapYaml(
  text: string,
  options: { mode: MindmapYamlValidationMode; fallbackTitle?: string },
): MindmapYamlValidationResult {
  const yamlText = extractYamlText(text)
  if (!yamlText) {
    return { ok: false, reason: '模型返回为空' }
  }

  const document = YAML.parseDocument(yamlText, {
    prettyErrors: false,
    strict: true,
  })

  if (document.errors.length > 0) {
    return { ok: false, reason: formatYamlError(document.errors[0]!) }
  }

  try {
    const parsedYaml = extractYaml(yamlText)
    if (options.mode === 'tree') {
      return validateTreeValue(parsedYaml, options.fallbackTitle ?? '思维导图')
    }

    return validateFragmentValue(parsedYaml, options.fallbackTitle ?? '片段')
  } catch (error) {
    return { ok: false, reason: formatReason(error) }
  }
}

function validateTreeValue(
  value: unknown,
  fallbackTitle: string,
): MindmapYamlValidationResult {
  const treeCandidate = sanitizeTreeCandidate(value)
  const rootTree = extractRootTree(treeCandidate, fallbackTitle)

  if (!rootTree || !rootTree.label.trim()) {
    return { ok: false, reason: 'YAML 未能形成有效的根节点' }
  }

  if (!rootTree.children || rootTree.children.length === 0) {
    return { ok: false, reason: 'YAML 根节点必须包含至少一个子节点' }
  }

  return { ok: true, tree: rootTree }
}

function validateFragmentValue(
  value: unknown,
  fallbackTitle: string,
): MindmapYamlValidationResult {
  const nodes = sanitizeForestCandidate(value)

  if (!nodes || nodes.length === 0) {
    return { ok: false, reason: 'YAML 片段必须包含至少一个节点' }
  }

  const validNodes = nodes.filter((node) => node.label.trim().length > 0)
  if (validNodes.length !== nodes.length) {
    return { ok: false, reason: 'YAML 片段包含空节点标签' }
  }

  return {
    ok: true,
    tree: {
      label: fallbackTitle,
      page_range: '',
      children: nodes,
    },
  }
}

function extractYamlText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''

  const fenced = trimmed.match(/```ya?ml\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  return trimmed
}

function formatYamlError(error: Error): string {
  return error.message
}

function formatReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function extractRootTree(treeCandidate: unknown, fallbackTitle: string): MindmapYamlNode | null {
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
        item !== null
        && typeof item === 'object'
        && 'label' in item
        && typeof (item as Record<string, unknown>).label === 'string',
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
