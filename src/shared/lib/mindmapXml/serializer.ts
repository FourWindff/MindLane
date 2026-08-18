/**
 * 序列化端（writer）：MindmapNode 树 → XML 字符串。
 * 文件面与片段面共用同一 writer 实现（PRD 23：迁移转换与运行时序列化同一实现）。
 */

import type { Edge, Node } from '@xyflow/react'
import type { MindLaneFile } from '../fileFormat.js'
import { escapeXml } from './escape.js'
import { xmlNodeTypeRegistry } from './registry.js'
import { MINDLANE_XML_VERSION, MINDLANE_ROOT_TAG, NODE_TAG } from './types.js'
import { getChildIdsOrdered } from '../mindmapTree'

/**
 * 子节点顺序：视觉顺序（position.y 升序，同 getChildIdsOrdered），保证序列化的
 * 同级顺序与界面一致，避免边数组顺序与视觉顺序漂移。
 */
function buildChildrenMap(nodes: Node[], edges: Edge[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const edge of edges) {
    const list = map.get(edge.source)
    if (list) list.push(edge.target)
    else map.set(edge.source, [edge.target])
  }
  for (const parentId of map.keys()) {
    map.set(parentId, getChildIdsOrdered(nodes, edges, parentId))
  }
  return map
}

function findRootIds(nodes: Node[], edges: Edge[]): string[] {
  const targets = new Set(edges.map((e) => e.target))
  return nodes.filter((n) => !targets.has(n.id)).map((n) => n.id)
}

/** 序列化单个 <node> 元素（含类型专属子元素与树子树）。 */
export function serializeNodeElement(node: Node, childrenXml: string, depth: number): string {
  const indent = '  '.repeat(depth)
  const descriptor = xmlNodeTypeRegistry.get(node.type ?? '')
  const typeAttrs = descriptor ? descriptor.write(node) : { content: '' }
  const typeChildrenXml = descriptor?.writeChildren ? descriptor.writeChildren(node) : ''
  const attrs: Record<string, string> = { id: node.id, type: node.type ?? 'text', ...typeAttrs }

  // Generic flags: collapsed / leftCollapsed / rightCollapsed (omitted by default = expanded)
  const genericFlags = ['collapsed', 'leftCollapsed', 'rightCollapsed'] as const
  for (const flag of genericFlags) {
    if ((node.data as Record<string, unknown>)[flag] === true) attrs[flag] = 'true'
  }

  const attrText = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join('')

  const inner = [typeChildrenXml, childrenXml].filter(Boolean).join('\n')
  if (!inner) {
    return `${indent}<${NODE_TAG}${attrText} />`
  }
  return `${indent}<${NODE_TAG}${attrText}>\n${inner}\n${indent}</${NODE_TAG}>`
}

/**
 * 序列化一棵子树（递归）。
 * @param nodes 全部节点（按 id 索引）
 * @param childrenOf 父 → 有序子节点 id
 */
function serializeSubtree(
  nodeId: string,
  nodesById: Map<string, Node>,
  childrenOf: Map<string, string[]>,
  depth: number,
): string {
  const node = nodesById.get(nodeId)
  if (!node) return ''
  const childIds = childrenOf.get(nodeId) ?? []
  const childrenXml = childIds
    .map((cid) => serializeSubtree(cid, nodesById, childrenOf, depth + 1))
    .join('\n')
  return serializeNodeElement(node, childrenXml, depth)
}

/**
 * 把节点/边序列化为 XML 片段（顶层多个 <node> = 多根）。
 * 位置、边、临时 UI 标记一律不落盘（PRD 2.2）。
 */
export function serializeTreeFragment(nodes: Node[], edges: Edge[]): string {
  const nodesById = new Map(nodes.map((n) => [n.id, n]))
  const childrenOf = buildChildrenMap(nodes, edges)
  const roots = findRootIds(nodes, edges)
  return roots.map((rid) => serializeSubtree(rid, nodesById, childrenOf, 0)).join('\n')
}

/** 序列化 mindmap 节的子树（readMindmap 输出 / 轮次状态）。 */
export interface MindmapSectionQuery {
  subtreeId?: string
  type?: string
  textContains?: string
  maxDepth?: number
}

function matchesQuery(node: Node, query: MindmapSectionQuery | undefined): boolean {
  if (!query) return true
  if (query.type && node.type !== query.type) return false
  if (query.textContains) {
    const data = node.data as Record<string, unknown>
    const label = typeof data.label === 'string' ? data.label : ''
    if (!label.includes(query.textContains)) return false
  }
  return true
}

/**
 * 序列化 mindmap 节为 XML 片段（树查询过滤后）。
 * 过滤语义：子树截断 + 类型/内容过滤 + 深度截断；只输出携带
 * id/type/content/collapsed 的节点（metadata/assets/documents 不进上下文）。
 */
export function serializeMindmapSection(
  nodes: Node[],
  edges: Edge[],
  query: MindmapSectionQuery = {},
): string {
  const nodesById = new Map(nodes.map((n) => [n.id, n]))
  const childrenOf = buildChildrenMap(nodes, edges)
  const roots = query.subtreeId ? [query.subtreeId] : findRootIds(nodes, edges)

  const hasTypeFilter = query.type !== undefined
  const hasTextFilter = query.textContains !== undefined

  const walk = (nodeId: string, depth: number): string => {
    const node = nodesById.get(nodeId)
    if (!node) return ''
    if (query.maxDepth !== undefined && depth > query.maxDepth) return ''

    const childIds = childrenOf.get(nodeId) ?? []
    // 类型/内容过滤下，子树只在满足条件的节点处保留（子树过滤后重组）。
    const keepNode = matchesQuery(node, query)
    const childrenXml = childIds
      .map((cid) => walk(cid, depth + 1))
      .filter(Boolean)
      .join('\n')

    if (!keepNode) return childrenXml
    return serializeNodeElement(node, childrenXml, depth)
  }

  const isFiltered = hasTypeFilter || hasTextFilter || query.maxDepth !== undefined
  if (isFiltered && !query.subtreeId && roots.length === 1) {
    // 过滤查询：保留根链，被过滤的中间节点用子树内容提升
    return walk(roots[0]!, 0)
  }
  return roots
    .map((rid) => walk(rid, 0))
    .filter(Boolean)
    .join('\n')
}

function textOf(value: string | undefined): string {
  return escapeXml(value ?? '')
}

/** 序列化 metadata 节。 */
function serializeMetadata(file: MindLaneFile): string {
  const { metadata, mindmap } = file
  const style = mindmap.style
  const styleAttrs = style
    ? ` structureType="${escapeXml(style.structureType)}" visualVariant="${escapeXml(style.visualVariant)}" colorScheme="${escapeXml(style.colorScheme)}"`
    : ''
  return [
    `  <metadata>`,
    `    <fileUuid>${textOf(metadata.fileUuid)}</fileUuid>`,
    `    <title>${textOf(metadata.title)}</title>`,
    `    <createdAt>${textOf(metadata.createdAt)}</createdAt>`,
    `    <updatedAt>${textOf(metadata.updatedAt)}</updatedAt>`,
    `    <viewport x="${textOf(String(mindmap.viewport.x))}" y="${textOf(String(mindmap.viewport.y))}" zoom="${textOf(String(mindmap.viewport.zoom))}" />`,
    `    <style${styleAttrs} />`,
    `  </metadata>`,
  ].join('\n')
}

/** 序列化 assets 节。 */
function serializeAssets(file: MindLaneFile): string {
  const assets = file.assets ?? []
  if (assets.length === 0) return `  <assets />`
  const lines = assets.map(
    (asset) =>
      `    <asset id="${textOf(asset.id)}" mime="${textOf(asset.mime)}" sha256="${textOf(asset.sha256)}">${asset.data}</asset>`,
  )
  return [`  <assets>`, ...lines, `  </assets>`].join('\n')
}

/** 序列化 documents 节。 */
function serializeDocuments(file: MindLaneFile): string {
  const docs = file.documents ?? []
  if (docs.length === 0) return `  <documents />`
  const lines = docs.map((doc) => {
    const attrs: Array<[string, string | undefined]> = [
      ['id', doc.id],
      ['type', doc.type],
      ['source', doc.source],
      ['filename', doc.filename],
      ['importedAt', doc.importedAt],
      ['title', doc.title],
      ['pageCount', doc.pageCount !== undefined ? String(doc.pageCount) : undefined],
      ['textPath', doc.textPath],
      ['sha256', doc.sha256],
    ]
    const attrText = attrs
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
      .join('')
    return `    <document${attrText} />`
  })
  return [`  <documents>`, ...lines, `  </documents>`].join('\n')
}

/**
 * 把规范化文件模型序列化为完整 XML 文档（单根 <mindlane version="1.0">）。
 * 版本号只放根元素；position/edges/布局产物不落盘。
 */
export function serializeMindlaneFile(file: MindLaneFile): string {
  const nodesById = new Map(file.mindmap.nodes.map((n) => [n.id, n]))
  const childrenOf = buildChildrenMap(file.mindmap.nodes as Node[], file.mindmap.edges)
  const roots = findRootIds(file.mindmap.nodes as Node[], file.mindmap.edges)
  const mindmapXml = roots.map((rid) => serializeSubtree(rid, nodesById, childrenOf, 2)).join('\n')

  const body = [
    serializeMetadata(file),
    `  <mindmap>`,
    mindmapXml,
    `  </mindmap>`,
    serializeAssets(file),
    serializeDocuments(file),
  ].join('\n')

  return `<${MINDLANE_ROOT_TAG} version="${MINDLANE_XML_VERSION}">\n${body}\n</${MINDLANE_ROOT_TAG}>`
}
