import YAML from 'yaml'
import type { Edge, Node } from '@xyflow/react'
import type { TextNodeData } from '@/features/mindmap/nodes/text'
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

/**
 * 解析 YAML 大纲片段（无 mindmap: 包裹）
 * 用于 AI Agent 批量添加节点时生成的子结构
 *
 * 如果片段包含多个根节点，会自动创建一个虚拟根节点将它们聚合。
 * 返回的节点 ID 使用 `newId()` 生成，不预设固定 ID。
 */
export function parseYamlFragment(yamlString: string): ParsedMindmap {
  let raw: unknown
  try {
    raw = YAML.parse(yamlString)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new YamlParseError(`YAML 解析失败: ${detail}`, err)
  }

  if (!raw) {
    throw new EmptyMindmapError()
  }

  // 片段顶层可能是数组（多根）或对象（单根键值对）或字符串（单节点）
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
    // 单根：直接解析，根节点 ID 由调用方决定，这里先用临时 ID
    const tempRootId = newId()
    buildGraph(rootNodes[0]!, null, nodes, edges, true, tempRootId)
  } else {
    // 多根：创建虚拟根，所有顶层节点挂在其下
    const virtualRootId = newId()
    nodes.push({
      id: virtualRootId,
      type: 'text',
      position: { x: 0, y: 0 },
      data: { label: '__virtual_root__' },
    })
    for (const rootNode of rootNodes) {
      buildGraph(rootNode, virtualRootId, nodes, edges, false)
    }
  }

  return { nodes, edges, title: rootNodes[0]!.label }
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
  rootId?: string,
): string {
  const id = isRoot ? (rootId ?? 'root') : newId()
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
