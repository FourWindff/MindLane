/**
 * Deserializer side (reader): XML → tree node array / normalized file model.
 *
 * - `parseXmlFragment`: AI fragment surface, tolerant HTML parser; multi-root
 *   fragments return multiple rootIds; malformed input is always mapped to an
 *   error code (PRD 5.4), never thrown bare.
 * - `deserializeMindLaneFile`: file surface, strict XML parser.
 */

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
  type MindmapXmlEdge,
  type MindmapXmlNode,
  type XmlElementLike,
} from './types.js'
import type { DomElementLike } from './dom.js'
import { newId } from '../ids.js'

/** Fragment parse result (insertFromXml reuses it for layout/aggregation/history). */
export interface ParsedFragment {
  nodes: MindmapXmlNode[]
  edges: MindmapXmlEdge[]
  /** Subtree root node id list (one for a single root, several for multiple roots) */
  rootIds: string[]
}

/** Fold a DOM element into a parser-agnostic view. */
function elementView(el: DomElementLike): XmlElementLike {
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    // The HTML parser lowercases attribute names; keep both the original name and a lowercase key so reads are case-insensitive
    attrs[attr.name] = unescapeXml(attr.value)
    if (attr.name !== attr.name.toLowerCase()) {
      attrs[attr.name.toLowerCase()] = attrs[attr.name]
    }
  }
  const elements: XmlElementLike[] = []
  let text = ''
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      elements.push(elementView(child as DomElementLike))
    } else if (child.nodeType === 3) {
      text += child.textContent ?? ''
    }
  }
  return { tag: el.tagName.toLowerCase(), attrs, text: text.trim(), elements }
}

export function isNodeElement(el: DomElementLike): boolean {
  return el.tagName.toLowerCase() === NODE_TAG
}

/**
 * Validate a fragment's node set: duplicate ids, touching the root anchor.
 * Pure-tree validation (multiple parents/cycles): nested parsing is acyclic by
 * construction; a duplicate id creates multiple parents/ambiguity → tree_invalid.
 * `allowRoot`: file-surface parsing allows the root anchor `root` (the fragment
 * surface forbids the AI from touching it).
 */
function assertFragmentTreeValid(seenIds: Set<string>, id: string, allowRoot = false): void {
  if (id === 'root' && !allowRoot) {
    throw new MindmapXmlError(
      'tree_invalid',
      'root is the mindmap anchor and cannot be created/moved/deleted',
    )
  }
  if (seenIds.has(id)) {
    throw new MindmapXmlError(
      'tree_invalid',
      `Duplicate node id "${id}" in the fragment (a pure tree allows no multiple parents/cycles)`,
    )
  }
  seenIds.add(id)
}

/** Recursively build a node + its edges from a single <node> element. */
function nodeFromElement(
  el: DomElementLike,
  seenIds: Set<string>,
  parentId: string | null,
  allowRoot = false,
): { node: MindmapXmlNode; edges: MindmapXmlEdge[] } {
  const view = elementView(el)
  const { attrs, elements } = view

  const type = attrOf(attrs, 'type')
  if (!type) {
    throw new MindmapXmlError('invalid_type', '<node> is missing the required type attribute')
  }
  const descriptor = xmlNodeTypeRegistry.get(type)
  if (!descriptor) {
    throw new MindmapXmlError(
      'invalid_type',
      `Unknown node type "${type}"; use a type from the registry`,
    )
  }

  const id = attrOf(attrs, 'id') !== undefined ? attrOf(attrs, 'id')! : newId()
  assertFragmentTreeValid(seenIds, id, allowRoot)

  // Type-specific child elements (station etc.) are separated from tree children (<node>)
  const typeElements = elements.filter((e) => e.tag !== NODE_TAG)
  const data = descriptor.read({ attrs, elements: typeElements })

  if (attrOf(attrs, 'collapsed') === 'true') data.collapsed = true
  if (attrOf(attrs, 'leftCollapsed') === 'true') data.leftCollapsed = true
  if (attrOf(attrs, 'rightCollapsed') === 'true') data.rightCollapsed = true

  // Image nodes must reference an asset (external URLs are disabled)
  if (type === 'image' && !attrOf(attrs, 'asset')) {
    throw new MindmapXmlError(
      'asset_not_found',
      'image nodes must reference the asset attribute (images are embedded in the <assets> section)',
    )
  }

  const node: MindmapXmlNode = {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  }

  const edges: MindmapXmlEdge[] = []
  if (parentId) {
    edges.push({ id: `e-${parentId}-${id}`, source: parentId, target: id, type: 'mindmap' })
  }

  for (const childEl of Array.from(el.children)) {
    if (!isNodeElement(childEl)) continue
    const sub = nodeFromElement(childEl, seenIds, id, allowRoot)
    edges.push(...sub.edges)
    const data = node.data as Record<string, unknown> & { __children?: MindmapXmlNode[] }
    data.__children ??= []
    data.__children.push(sub.node)
  }

  return { node, edges }
}

/** Parse the top-level <node> elements among the candidates into nodes/edges (shared by the fragment and file surfaces). */
function collectNodes(
  candidates: Iterable<DomElementLike>,
  allowRoot: boolean,
): { nodes: MindmapXmlNode[]; edges: MindmapXmlEdge[]; rootIds: string[] } {
  const seenIds = new Set<string>()
  const nodes: MindmapXmlNode[] = []
  const edges: MindmapXmlEdge[] = []
  const rootIds: string[] = []

  for (const el of candidates) {
    if (!isNodeElement(el)) continue
    const { node, edges: subEdges } = nodeFromElement(el, seenIds, null, allowRoot)
    nodes.push(node)
    rootIds.push(node.id)
    edges.push(...subEdges)
  }
  return { nodes, edges, rootIds }
}

/** Flatten the `__children` intermediate state into flat nodes (parent before child). */
function flattenChildren(nodes: MindmapXmlNode[]): MindmapXmlNode[] {
  const flat: MindmapXmlNode[] = []
  const visit = (n: MindmapXmlNode) => {
    const children = ((n.data as Record<string, unknown>).__children ?? []) as MindmapXmlNode[]
    delete (n.data as Record<string, unknown>).__children
    flat.push(n)
    for (const child of children) visit(child)
  }
  for (const n of nodes) visit(n)
  return flat
}

/**
 * Parse an AI XML fragment (tolerant HTML parser).
 *
 * Error codes: empty_xml / text_unescaped / xml_parse_error / invalid_type / tree_invalid / asset_not_found.
 * Validation never yields partial results — any failing node throws for the whole input.
 */
export async function parseXmlFragment(xml: string): Promise<ParsedFragment> {
  const trimmed = xml.trim()
  if (!trimmed) {
    throw new MindmapXmlError('empty_xml', 'XML fragment is empty; no nodes produced')
  }

  const unescaped = findUnescapedInAttrValues(trimmed)
  if (unescaped) {
    throw new MindmapXmlError('text_unescaped', `Unescaped characters remain in text: ${unescaped}`)
  }

  const normalized = normalizeSelfClosingTags(trimmed)
  const doc = await parseXmlTolerant(normalized)

  const { nodes, edges, rootIds } = collectNodes(topLevelElements(doc), false)
  if (nodes.length === 0) {
    throw new MindmapXmlError('empty_xml', 'No <node> element found in the XML fragment')
  }

  return { nodes: flattenChildren(nodes), edges, rootIds }
}

// ─── File surface ──────────────────────────────────────────────────────────────────

function sectionElement(doc: ParsedDocumentLike, tag: string): DomElementLike | undefined {
  return Array.from(doc.documentElement.children).find((el) => el.tagName.toLowerCase() === tag)
}

function childElementText(el: DomElementLike, tag: string): string | undefined {
  const lowerTag = tag.toLowerCase()
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() === lowerTag) {
      return (child.textContent ?? '').trim()
    }
  }
  return undefined
}

function childElements(el: DomElementLike, tag: string): DomElementLike[] {
  return Array.from(el.children).filter((child) => child.tagName.toLowerCase() === tag)
}

function parseMetadata(el: DomElementLike | undefined, fileUuid: string): MindLaneFile['metadata'] {
  const metadata: MindLaneFile['metadata'] = {
    fileUuid,
    title: 'Untitled',
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

function parseViewport(el: DomElementLike | undefined): { x: number; y: number; zoom: number } {
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

function parseStyle(el: DomElementLike | undefined): MindLaneFile['mindmap']['style'] {
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

function parseAsset(el: DomElementLike): NonNullable<MindLaneFile['assets']>[number] {
  return {
    id: el.getAttribute('id') ?? newId(),
    mime: el.getAttribute('mime') ?? 'image/png',
    sha256: el.getAttribute('sha256') ?? '',
    data: (el.textContent ?? '').trim(),
  }
}

function parseDocument(el: DomElementLike): MindLaneFile['documents'][number] {
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

/** Parse the mindmap section (strict: exactly one tree, root node fixed to id="root"). */
function parseMindmapSection(el: DomElementLike | undefined): {
  nodes: MindLaneNode[]
  edges: MindmapXmlEdge[]
} {
  if (!el) return { nodes: [], edges: [] }
  const { nodes, edges, rootIds } = collectNodes(Array.from(el.children), true)

  if (nodes.length === 0) {
    throw new MindmapXmlError('empty_xml', 'mindmap section is empty: no root node')
  }
  if (rootIds.length > 1) {
    throw new MindmapXmlError(
      'tree_invalid',
      `mindmap section has multiple root nodes (${rootIds.join(', ')}); a file must be exactly one tree`,
    )
  }
  if (rootIds[0] !== 'root') {
    throw new MindmapXmlError(
      'tree_invalid',
      `mindmap section root node must be id="root" (actual: "${rootIds[0]}")`,
    )
  }

  // Flatten the __children intermediate state
  const flat = flattenChildren(nodes)

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

/**
 * Deserialize a complete XML file (strict mode). Files are produced by the
 * editor; malformed input maps to error codes. Positions are not persisted →
 * all set to {0,0}; the layout algorithm recomputes them on open (caller's job).
 */
export async function deserializeMindLaneFile(xml: string): Promise<MindLaneFile> {
  const trimmed = xml.trim()
  if (!trimmed) {
    throw new MindmapXmlError('empty_xml', 'File content is empty')
  }
  const doc = await parseXmlStrict(normalizeSelfClosingTags(trimmed))
  const root = doc.documentElement
  if (root.tagName.toLowerCase() !== MINDLANE_ROOT_TAG) {
    throw new MindmapXmlError(
      'xml_parse_error',
      `Root element must be <${MINDLANE_ROOT_TAG}> (actual: <${root.tagName}>)`,
    )
  }
  const version = root.getAttribute('version')
  if (version !== MINDLANE_XML_VERSION) {
    throw new MindmapXmlError(
      'xml_parse_error',
      `Unsupported version "${version ?? '(missing)'}"; only ${MINDLANE_XML_VERSION} is supported`,
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
