/**
 * 反序列化端（reader）：XML → 树节点数组 / 规范化文件模型。
 *
 * - `parseXmlFragment`：AI 片段面，容错 HTML parser；多根片段返回多个 rootIds；
 *   畸形输入一律映射错误码（PRD 5.4），绝不裸抛。
 * - `deserializeMindlaneFile`：文件面，严格 XML parser。
 */

import type { Edge, Node } from '@xyflow/react'
import type { MindLaneFile, MindLaneNode } from '../fileFormat.js'
import { unescapeXml } from './escape.js'
import { findUnescapedInAttrValues, normalizeSelfClosingTags } from './normalize.js'
import {
  parseXmlStrict,
  parseXmlTolerant,
  topLevelElements,
  type ParsedDocumentLike,
} from './parser.js'
import { attrOf, xmlNodeTypeRegistry } from './registry.js'
import {
  MINDLANE_ROOT_TAG,
  MINDLANE_XML_VERSION,
  MindmapXmlError,
  NODE_TAG,
  type XmlElementLike,
} from './types.js'
import { newId } from '../mindmapTree.js'

/** 片段解析产物（与 parseYamlFragment 对齐，insertFromXml 复用布局/聚合/历史）。 */
export interface ParsedFragment {
  nodes: Node[]
  edges: Edge[]
  /** 子树根节点 ID 列表（单根 1 个，多根多个） */
  rootIds: string[]
}

/** 把 DOM 元素折叠为解析器无关的视图。 */
function elementView(el: Element): XmlElementLike {
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    // HTML parser 会把属性名小写化；保留原名 + 小写键双索引，读取时大小写不敏感
    attrs[attr.name] = unescapeXml(attr.value)
    if (attr.name !== attr.name.toLowerCase()) {
      attrs[attr.name.toLowerCase()] = attrs[attr.name]
    }
  }
  const elements: XmlElementLike[] = []
  let text = ''
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      elements.push(elementView(child as Element))
    } else if (child.nodeType === 3) {
      text += child.textContent ?? ''
    }
  }
  return { tag: el.tagName.toLowerCase(), attrs, text: text.trim(), elements }
}

function isNodeElement(el: Element): boolean {
  return el.tagName.toLowerCase() === NODE_TAG
}

/**
 * 校验片段节点集合：重复 id、触碰 root 锚点。
 * 纯树校验（多父/环）：嵌套解析天然无环；重复 id 会制造多父/歧义 → tree_invalid。
 * `allowRoot`：文件面解析允许根锚点 `root`（片段面禁止 AI 触碰）。
 */
function assertFragmentTreeValid(seenIds: Set<string>, id: string, allowRoot = false): void {
  if (id === 'root' && !allowRoot) {
    throw new MindmapXmlError('tree_invalid', 'root 是导图锚点，不可被创建/移动/删除')
  }
  if (seenIds.has(id)) {
    throw new MindmapXmlError('tree_invalid', `片段中出现重复节点 id「${id}」（纯树不允许多父/环）`)
  }
  seenIds.add(id)
}

/** 从单个 <node> 元素递归构建 ReactFlow Node + 边。 */
function nodeFromElement(
  el: Element,
  seenIds: Set<string>,
  parentId: string | null,
  allowRoot = false,
): { node: Node; edges: Edge[] } {
  const view = elementView(el)
  const { attrs, elements } = view

  const type = attrOf(attrs, 'type')
  if (!type) {
    throw new MindmapXmlError('invalid_type', '<node> 缺少必填的 type 属性')
  }
  const descriptor = xmlNodeTypeRegistry.get(type)
  if (!descriptor) {
    throw new MindmapXmlError('invalid_type', `未知节点类型「${type}」，请使用注册表中的类型`)
  }

  const id = attrOf(attrs, 'id') !== undefined ? attrOf(attrs, 'id')! : newId()
  assertFragmentTreeValid(seenIds, id, allowRoot)

  // 类型专属子元素（station 等）与树子节点（<node>）分离
  const typeElements = elements.filter((e) => e.tag !== NODE_TAG)
  const data = descriptor.read({ attrs, elements: typeElements })

  if (attrOf(attrs, 'collapsed') === 'true') data.collapsed = true

  // image 节点必须引用 asset（外部 URL 禁用）
  if (type === 'image' && !attrOf(attrs, 'asset')) {
    throw new MindmapXmlError(
      'asset_not_found',
      'image 节点必须引用 asset 属性（图片内嵌在 <assets> 节）',
    )
  }

  const node: Node = {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  }

  const edges: Edge[] = []
  if (parentId) {
    edges.push({ id: `e-${parentId}-${id}`, source: parentId, target: id, type: 'mindmap' })
  }

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== 1) continue
    const childEl = child as Element
    if (!isNodeElement(childEl)) continue
    const sub = nodeFromElement(childEl, seenIds, id, allowRoot)
    edges.push(...sub.edges)
    const data = node.data as Record<string, unknown> & { __children?: Node[] }
    data.__children ??= []
    data.__children.push(sub.node)
  }

  return { node, edges }
}

/**
 * 解析 AI 的 XML 片段（容错 HTML parser）。
 *
 * 错误码：empty_xml / text_unescaped / xml_parse_error / invalid_type / tree_invalid / asset_not_found。
 * 校验不产生部分结果——任一节点失败整体抛错。
 */
export async function parseXmlFragment(xml: string): Promise<ParsedFragment> {
  const trimmed = xml.trim()
  if (!trimmed) {
    throw new MindmapXmlError('empty_xml', 'XML 片段为空，未产出任何节点')
  }

  const unescaped = findUnescapedInAttrValues(trimmed)
  if (unescaped) {
    throw new MindmapXmlError('text_unescaped', `文本残留未转义字符：${unescaped}`)
  }

  const normalized = normalizeSelfClosingTags(trimmed)
  const doc = await parseXmlTolerant(normalized)

  const seenIds = new Set<string>()
  const nodes: Node[] = []
  const edges: Edge[] = []
  const rootIds: string[] = []

  for (const el of topLevelElements(doc)) {
    if (!isNodeElement(el)) continue
    const { node, edges: subEdges } = nodeFromElement(el, seenIds, null)
    nodes.push(node)
    rootIds.push(node.id)
    edges.push(...subEdges)
  }

  if (nodes.length === 0) {
    throw new MindmapXmlError('empty_xml', 'XML 片段中未找到任何 <node> 元素')
  }

  // 展开 __children 中间态为平铺 nodes（父先于子）
  const flatNodes: Node[] = []
  const flatten = (n: Node) => {
    const children = ((n.data as Record<string, unknown>).__children ?? []) as Node[]
    delete (n.data as Record<string, unknown>).__children
    flatNodes.push(n)
    for (const c of children) flatten(c)
  }
  for (const n of nodes) flatten(n)

  return { nodes: flatNodes, edges, rootIds }
}

// ─── 文件面 ──────────────────────────────────────────────────────────────────

function sectionElement(doc: ParsedDocumentLike, tag: string): Element | undefined {
  return Array.from(doc.documentElement.childNodes).find(
    (n): n is Element => n.nodeType === 1 && (n as Element).tagName.toLowerCase() === tag,
  )
}

function childElementText(el: Element, tag: string): string | undefined {
  const lowerTag = tag.toLowerCase()
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== 1) continue
    if ((child as Element).tagName.toLowerCase() === lowerTag) {
      return (child.textContent ?? '').trim()
    }
  }
  return undefined
}

function childElements(el: Element, tag: string): Element[] {
  return Array.from(el.childNodes).filter(
    (n): n is Element => n.nodeType === 1 && (n as Element).tagName.toLowerCase() === tag,
  )
}

function parseMetadata(el: Element | undefined, fileUuid: string): MindLaneFile['metadata'] {
  const metadata: MindLaneFile['metadata'] = {
    fileUuid,
    title: '未命名',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (!el) return metadata
  metadata.fileUuid = childElementText(el, 'fileUuid') ?? metadata.fileUuid
  metadata.title = childElementText(el, 'title') ?? metadata.title
  metadata.createdAt = childElementText(el, 'createdAt') ?? metadata.createdAt
  metadata.updatedAt = childElementText(el, 'updatedAt') ?? metadata.updatedAt
  return metadata
}

function parseViewport(el: Element | undefined): { x: number; y: number; zoom: number } {
  const vp = { x: 0, y: 0, zoom: 1 }
  if (!el) return vp
  const x = Number(el.getAttribute('x'))
  const y = Number(el.getAttribute('y'))
  const zoom = Number(el.getAttribute('zoom'))
  if (!Number.isNaN(x)) vp.x = x
  if (!Number.isNaN(y)) vp.y = y
  if (!Number.isNaN(zoom)) vp.zoom = zoom
  return vp
}

function parseStyle(el: Element | undefined): MindLaneFile['mindmap']['style'] {
  if (!el) return undefined
  const structureType = el.getAttribute('structureType')
  const visualVariant = el.getAttribute('visualVariant')
  const colorScheme = el.getAttribute('colorScheme')
  if (!structureType && !visualVariant && !colorScheme) return undefined
  return {
    ...(structureType === 'logic' || structureType === 'mindmap' ? { structureType } : {}),
    ...(visualVariant === 'card' || visualVariant === 'outline' || visualVariant === 'minimal'
      ? { visualVariant }
      : {}),
    ...(colorScheme ? { colorScheme } : {}),
  } as MindLaneFile['mindmap']['style']
}

function parseAsset(el: Element): NonNullable<MindLaneFile['assets']>[number] {
  return {
    id: el.getAttribute('id') ?? newId(),
    mime: el.getAttribute('mime') ?? 'image/png',
    sha256: el.getAttribute('sha256') ?? '',
    data: (el.textContent ?? '').trim(),
  }
}

function parseDocument(el: Element): MindLaneFile['documents'][number] {
  const doc: MindLaneFile['documents'][number] = {
    id: el.getAttribute('id') ?? '',
    type: (el.getAttribute('type') as MindLaneFile['documents'][number]['type']) ?? 'text',
    source: el.getAttribute('source') ?? '',
    filename: el.getAttribute('filename') ?? '',
    importedAt: el.getAttribute('importedAt') ?? new Date().toISOString(),
  }
  const title = el.getAttribute('title')
  if (title) doc.title = title
  const pageCountAttr = el.getAttribute('pageCount')
  const pageCount = pageCountAttr !== null ? Number(pageCountAttr) : NaN
  if (!Number.isNaN(pageCount)) doc.pageCount = pageCount
  const textPath = el.getAttribute('textPath')
  if (textPath) doc.textPath = textPath
  const sha256 = el.getAttribute('sha256')
  if (sha256) doc.sha256 = sha256
  return doc
}

/** 解析 mindmap 节（严格：恰好一棵树，根节点固定 id="root"）。 */
function parseMindmapSection(el: Element | undefined): {
  nodes: MindLaneNode[]
  edges: MindLaneEdgeLike[]
} {
  if (!el) return { nodes: [], edges: [] }
  const seenIds = new Set<string>()
  const nodes: Node[] = []
  const edges: Edge[] = []
  const rootIds: string[] = []

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== 1) continue
    const childEl = child as Element
    if (!isNodeElement(childEl)) continue
    const { node, edges: subEdges } = nodeFromElement(childEl, seenIds, null, true)
    nodes.push(node)
    rootIds.push(node.id)
    edges.push(...subEdges)
  }

  if (nodes.length === 0) {
    throw new MindmapXmlError('empty_xml', 'mindmap 节为空：没有根节点')
  }
  if (rootIds.length > 1) {
    throw new MindmapXmlError(
      'tree_invalid',
      `mindmap 节有多个根节点（${rootIds.join(', ')}），文件必须恰好一棵树`,
    )
  }
  if (rootIds[0] !== 'root') {
    throw new MindmapXmlError(
      'tree_invalid',
      `mindmap 节根节点必须是 id="root"（实际为「${rootIds[0]}」）`,
    )
  }

  // 展开 __children 中间态
  const flat: Node[] = []
  const flatten = (n: Node) => {
    const children = ((n.data as Record<string, unknown>).__children ?? []) as Node[]
    delete (n.data as Record<string, unknown>).__children
    flat.push(n)
    for (const c of children) flatten(c)
  }
  for (const n of nodes) flatten(n)

  return {
    nodes: flat.map(
      (n) =>
        ({
          id: n.id,
          type: n.type! as MindLaneNode['type'],
          position: { x: 0, y: 0 },
          data: n.data,
        }) as MindLaneNode,
    ),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
    })),
  }
}

interface MindLaneEdgeLike {
  id: string
  source: string
  target: string
  type?: string
}

/**
 * 反序列化完整 XML 文件（严格模式）。文件由编辑器生成，畸形输入映射错误码。
 * 位置信息不落盘 → 全部置 {0,0}，打开时由布局算法重算（调用方负责）。
 */
export async function deserializeMindlaneFile(xml: string): Promise<MindLaneFile> {
  const trimmed = xml.trim()
  if (!trimmed) {
    throw new MindmapXmlError('empty_xml', '文件内容为空')
  }
  const doc = await parseXmlStrict(normalizeSelfClosingTags(trimmed))
  const root = doc.documentElement
  if (root.tagName.toLowerCase() !== MINDLANE_ROOT_TAG) {
    throw new MindmapXmlError(
      'xml_parse_error',
      `根元素必须是 <${MINDLANE_ROOT_TAG}>（实际为 <${root.tagName}>）`,
    )
  }
  const version = root.getAttribute('version')
  if (version !== MINDLANE_XML_VERSION) {
    throw new MindmapXmlError(
      'xml_parse_error',
      `不支持的版本「${version ?? '(缺失)'}」，仅支持 ${MINDLANE_XML_VERSION}`,
    )
  }

  const metadataEl = sectionElement(doc, 'metadata')
  const metadata = parseMetadata(metadataEl, '')
  const viewportEl = metadataEl ? childElements(metadataEl, 'viewport')[0] : undefined
  const styleEl = metadataEl ? childElements(metadataEl, 'style')[0] : undefined

  const mindmapEl = sectionElement(doc, 'mindmap')
  const { nodes, edges } = parseMindmapSection(mindmapEl)
  const viewport = parseViewport(viewportEl)
  const style = parseStyle(styleEl)

  const assetsEl = sectionElement(doc, 'assets')
  const assets = assetsEl ? childElements(assetsEl, 'asset').map(parseAsset) : []

  const documentsEl = sectionElement(doc, 'documents')
  const documents = documentsEl ? childElements(documentsEl, 'document').map(parseDocument) : []

  return {
    version: MINDLANE_XML_VERSION,
    metadata,
    mindmap: { nodes, edges, viewport, style },
    assets,
    documents,
  }
}
