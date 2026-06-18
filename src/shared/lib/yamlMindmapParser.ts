import YAML from 'yaml'
import type { Edge, Node } from '@xyflow/react'
import type { TextNodeData } from '@/features/mindmap/nodes/text/types'
import { newId } from '@/shared/lib/mindmapTree'

interface MindmapYamlNode {
  label: string
  page_range?: string
  summary?: string
  children?: MindmapYamlNode[]
}

interface ParsedMindmap {
  nodes: Node[]
  edges: Edge[]
  title: string
}

export class YamlParseError extends Error {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'YamlParseError'
    this.cause = cause
  }
}

export class EmptyMindmapError extends Error {
  constructor(message = 'YAML 中未找到有效的 mindmap 大纲') {
    super(message)
    this.name = 'EmptyMindmapError'
  }
}

/** 用于标记 parseYamlFragment 多根场景下创建的虚拟根节点 */
export const VIRTUAL_ROOT_SYMBOL = Symbol('virtualRoot')

function parseYamlSafely(yamlString: string): unknown {
  try {
    return YAML.parse(yamlString)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new YamlParseError(`YAML 解析失败: ${detail}`, err)
  }
}

/**
 * 修复 AI 常见的 YAML 格式错误：
 * 当 `- "父节点"` 后面跟着缩进的子节点 `- "子节点"` 时，
 * AI 经常忘记在父节点后加冒号，导致 YAML 解析失败。
 */
function fixAiYamlErrors(yamlString: string): string {
  const lines = yamlString.split('\n')
  const fixed: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    fixed.push(line)

    // 检测当前行是否是列表项（以 - 开头，值为字符串）
    const match = line.match(/^(\s*)-\s*"([^"]+)"\s*$/)
    if (!match) continue

    const indent = match[1]!.length
    const nextLine = lines[i + 1]
    if (!nextLine) continue

    // 检测下一行是否是缩进的子列表项
    const nextMatch = nextLine.match(/^(\s*)-/)
    if (!nextMatch) continue

    const nextIndent = nextMatch[1]!.length
    // 如果下一行缩进更深，说明当前行应该是父节点，需要在末尾加冒号
    if (nextIndent > indent) {
      fixed[fixed.length - 1] = `${line}:`
    }
  }

  return fixed.join('\n')
}

export function parseYamlToMindmap(yamlString: string): ParsedMindmap {
  const raw = parseYamlSafely(yamlString)

  if (!raw || typeof raw !== 'object') {
    throw new EmptyMindmapError()
  }

  const root = extractRootNode(raw as Record<string, unknown>)
  if (!root) {
    throw new EmptyMindmapError()
  }

  const title = typeof (raw as Record<string, unknown>).document === 'object'
    ? extractTitle((raw as Record<string, unknown>).document) ?? root.label
    : root.label

  const nodes: Node[] = []
  const edges: Edge[] = []

  buildGraph(root, null, nodes, edges, true)

  return { nodes, edges, title }
}

interface ParsedFragment extends ParsedMindmap {
  /** 子树根节点 ID 列表（单根时为 1 个，多根时为多个） */
  rootIds: string[]
}

/**
 * 解析 YAML 大纲片段（无 mindmap: 包裹）
 * 用于 AI Agent 批量添加节点时生成的子结构
 *
 * 如果片段包含多个根节点，会自动创建一个虚拟根节点将它们聚合。
 * 返回的节点 ID 使用 `newId()` 生成，不预设固定 ID。
 */
export function parseYamlFragment(yamlString: string): ParsedFragment {
  let raw: unknown
  try {
    raw = parseYamlSafely(yamlString)
  } catch {
    const fixed = fixAiYamlErrors(yamlString)
    raw = parseYamlSafely(fixed)
  }

  if (!raw) {
    throw new EmptyMindmapError()
  }

  let rootNodes: MindmapYamlNode[] = []

  if (Array.isArray(raw)) {
    rootNodes = raw.flatMap((entry) => {
      const node = parseOutlineEntry(entry)
      return node ? [node] : []
    })
  } else if (typeof raw === 'object') {
    const entries = Object.entries(raw as Record<string, unknown>)
    if (entries.length > 0) {
      const [titleKey, body] = entries[0]!
      const parsed = parseTitleString(titleKey)
      const children = parseChildren(body)
      const node: MindmapYamlNode = { label: parsed.label }
      if (parsed.pageRange) node.page_range = parsed.pageRange
      if (parsed.summary) node.summary = parsed.summary
      if (children.length > 0) node.children = children
      rootNodes = [node]
    }
  } else if (typeof raw === 'string') {
    const parsed = parseTitleString(raw)
    rootNodes = [{ label: parsed.label }]
  }

  if (rootNodes.length === 0) {
    throw new EmptyMindmapError()
  }

  const nodes: Node[] = []
  const edges: Edge[] = []

  if (rootNodes.length === 1) {
    const rootId = newId()
    buildGraph(rootNodes[0]!, null, nodes, edges, true, rootId)
    return { nodes, edges, title: rootNodes[0]!.label, rootIds: [rootId] }
  }

  // 多根：创建虚拟根，所有顶层节点挂在其下
  const virtualRootId = newId()
  nodes.push({
    id: virtualRootId,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { label: '', [VIRTUAL_ROOT_SYMBOL]: true },
  })
  const rootIds: string[] = []
  for (const rootNode of rootNodes) {
    rootIds.push(buildGraph(rootNode, virtualRootId, nodes, edges, false))
  }

  return { nodes, edges, title: rootNodes[0]!.label, rootIds }
}

function extractRootNode(raw: Record<string, unknown>): MindmapYamlNode | null {
  const mindmap = raw.mindmap
  if (mindmap == null) return null

  if (typeof mindmap === 'string') {
    const parsed = parseTitleString(mindmap)
    const node: MindmapYamlNode = { label: parsed.label }
    if (parsed.pageRange) node.page_range = parsed.pageRange
    if (parsed.summary) node.summary = parsed.summary
    return node
  }

  if (Array.isArray(mindmap)) {
    if (mindmap.length === 0) return null
    return parseOutlineEntry(mindmap[0])
  }

  if (typeof mindmap === 'object') {
    const entries = Object.entries(mindmap as Record<string, unknown>)
    if (entries.length === 0) return null
    const [titleKey, body] = entries[0]!
    const rootLabel = parseTitleString(titleKey)
    const children = parseChildren(body)
    const node: MindmapYamlNode = { label: rootLabel.label }
    if (rootLabel.pageRange) node.page_range = rootLabel.pageRange
    if (rootLabel.summary) node.summary = rootLabel.summary
    if (children.length > 0) node.children = children
    return node
  }

  return null
}

function parseChildren(body: unknown): MindmapYamlNode[] {
  if (body == null) return []
  if (Array.isArray(body)) {
    return body.flatMap((entry) => {
      const node = parseOutlineEntry(entry)
      return node ? [node] : []
    })
  }
  return []
}

function parseOutlineEntry(entry: unknown): MindmapYamlNode | null {
  if (entry == null) return null

  if (typeof entry === 'string') {
    const parsed = parseTitleString(entry)
    const node: MindmapYamlNode = { label: parsed.label }
    if (parsed.pageRange) node.page_range = parsed.pageRange
    if (parsed.summary) node.summary = parsed.summary
    return node
  }

  if (typeof entry === 'object') {
    const obj = entry as Record<string, unknown>
    const entries = Object.entries(obj)
    if (entries.length === 0) return null
    const [titleKey, body] = entries[0]!
    const parsed = parseTitleString(isScalarOutlineValue(body)
      ? formatScalarOutlineTitle(titleKey, body)
      : titleKey)
    const children = isScalarOutlineValue(body) ? [] : parseChildren(body)
    const node: MindmapYamlNode = { label: parsed.label }
    if (parsed.pageRange) node.page_range = parsed.pageRange
    if (parsed.summary) node.summary = parsed.summary
    if (children.length > 0) node.children = children
    return node
  }

  return null
}

function isScalarOutlineValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function formatScalarOutlineTitle(rawTitle: string, value: string | number | boolean): string {
  return `${rawTitle}: ${String(value).trim()}`
}

interface ParsedTitle {
  label: string
  pageRange?: string
  summary?: string
}

function parseTitleString(value: string): ParsedTitle {
  const text = String(value).trim()

  const pageMatch = text.match(/\((p?\.?\s*\d+(?:\s*-\s*\d+)?)\)\s*$/i)
    ?? text.match(/\((p?\.?\s*\d+(?:\s*-\s*\d+)?)\)\s*[—\-:]\s*(.+)$/i)

  if (pageMatch) {
    const before = text.slice(0, pageMatch.index).trim()
    const pageRange = pageMatch[1]?.trim()
    const trailing = pageMatch[2]?.trim()
    return {
      label: before || text,
      ...(pageRange ? { pageRange } : {}),
      ...(trailing ? { summary: trailing } : {}),
    }
  }

  return { label: text }
}

function extractTitle(documentField: unknown): string | undefined {
  if (!documentField || typeof documentField !== 'object') return undefined
  const obj = documentField as Record<string, unknown>
  const title = obj.title
  return typeof title === 'string' && title.trim() ? title.trim() : undefined
}

function buildGraph(
  yamlNode: MindmapYamlNode,
  parentId: string | null,
  nodes: Node[],
  edges: Edge[],
  isRoot: boolean,
  explicitRootId?: string,
): string {
  const id = isRoot ? (explicitRootId ?? 'root') : newId()
  const data: TextNodeData = { label: yamlNode.label }
  if (yamlNode.page_range) data.pageRange = yamlNode.page_range
  if (yamlNode.summary) data.summary = yamlNode.summary

  nodes.push({
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data,
  })

  if (parentId) {
    edges.push({
      id: `e-${parentId}-${id}`,
      source: parentId,
      target: id,
      type: 'mindmap',
      className: 'mindmap-edge',
    })
  }

  const children = yamlNode.children ?? []
  for (const child of children) {
    buildGraph(child, id, nodes, edges, false)
  }

  return id
}
