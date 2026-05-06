import YAML from 'yaml'
import type { Edge, Node } from '@xyflow/react'
import type { TopicNodeData } from '@/features/mindmap/nodes/topic'
import { newId } from '@/shared/lib/mindmapTree'

export interface MindmapYamlNode {
  label: string
  page_range?: string
  summary?: string
  children?: MindmapYamlNode[]
}

export interface ParsedMindmap {
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

export function parseYamlToMindmap(yamlString: string): ParsedMindmap {
  let raw: unknown
  try {
    raw = YAML.parse(yamlString)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new YamlParseError(`YAML 解析失败: ${detail}`, err)
  }

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

function extractRootNode(raw: Record<string, unknown>): MindmapYamlNode | null {
  const mindmap = raw.mindmap
  if (mindmap == null) return null

  // mindmap 顶层可能是字符串(无子节点)、对象({rootLabel: children})、或数组(多根列表)
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
    // 形如 `- "标题": [子项]`
    const [titleKey, body] = entries[0]!
    const parsed = parseTitleString(titleKey)
    const children = parseChildren(body)
    const node: MindmapYamlNode = { label: parsed.label }
    if (parsed.pageRange) node.page_range = parsed.pageRange
    if (parsed.summary) node.summary = parsed.summary
    if (children.length > 0) node.children = children
    return node
  }

  return null
}

interface ParsedTitle {
  label: string
  pageRange?: string
  summary?: string
}

function parseTitleString(value: string): ParsedTitle {
  const text = String(value).trim()

  // 形如 "标题 (p.12-15) — 摘要"
  // 优先尝试提取尾部的页码标记
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
): string {
  const id = isRoot ? 'root' : newId()
  const data: TopicNodeData = { label: yamlNode.label }
  if (yamlNode.page_range) data.pageRange = yamlNode.page_range
  if (yamlNode.summary) data.summary = yamlNode.summary

  nodes.push({
    id,
    type: 'topic',
    position: { x: 0, y: 0 },
    data,
  })

  if (parentId) {
    edges.push({
      id: `e-${parentId}-${id}`,
      source: parentId,
      target: id,
      type: 'smoothstep',
      className: 'mindmap-edge',
    })
  }

  const children = yamlNode.children ?? []
  for (const child of children) {
    buildGraph(child, id, nodes, edges, false)
  }

  return id
}
