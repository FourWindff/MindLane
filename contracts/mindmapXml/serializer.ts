/**
 * Serializer side (writer): MindmapNode tree → XML string.
 * The file surface and fragment surface share one writer implementation (PRD 23:
 * migration conversion and runtime serialization use the same implementation).
 */

import type { MindLaneFile } from '../fileFormat.js'
import { escapeXml } from './escape.js'
import { xmlNodeTypeRegistry } from './registry.js'
import {
  MINDLANE_XML_VERSION,
  MINDLANE_ROOT_TAG,
  NODE_TAG,
  type MindmapXmlEdge,
  type MindmapXmlNode,
} from './types.js'
import { newId } from '../ids.js'

/**
 * Child order: visual order (position.y ascending), so the serialized sibling
 * order matches the UI and the edge-array order cannot drift from the visual one.
 */
function getChildIdsOrdered(
  nodes: MindmapXmlNode[],
  edges: MindmapXmlEdge[],
  parentId: string,
): string[] {
  const ids = edges.filter((edge) => edge.source === parentId).map((edge) => edge.target)
  const y = new Map(nodes.map((n) => [n.id, n.position.y]))
  return ids.sort((a, b) => (y.get(a) ?? 0) - (y.get(b) ?? 0))
}

function buildChildrenMap(nodes: MindmapXmlNode[], edges: MindmapXmlEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const parentId of new Set(edges.map((edge) => edge.source))) {
    map.set(parentId, getChildIdsOrdered(nodes, edges, parentId))
  }
  return map
}

function findRootIds(nodes: MindmapXmlNode[], edges: MindmapXmlEdge[]): string[] {
  const targets = new Set(edges.map((e) => e.target))
  return nodes.filter((n) => !targets.has(n.id)).map((n) => n.id)
}

/** Serialize a single <node> element (including type-specific children and the tree subtree). */
function serializeNodeElement(node: MindmapXmlNode, childrenXml: string, depth: number): string {
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
 * Serialize one subtree (recursive). When `query` is present, filter by it
 * (`serializeMindmapSection`): filtered-out intermediate nodes are replaced by
 * their subtree content, and `maxDepth` truncates.
 * @param nodesById All nodes (indexed by id)
 * @param childrenOf Parent → ordered child node ids
 */
function serializeSubtree(
  nodeId: string,
  nodesById: Map<string, MindmapXmlNode>,
  childrenOf: Map<string, string[]>,
  depth: number,
  query?: MindmapSectionQuery,
): string {
  const node = nodesById.get(nodeId)
  if (!node) return ''
  if (query?.maxDepth !== undefined && depth > query.maxDepth) return ''

  const childrenXml = (childrenOf.get(nodeId) ?? [])
    .map((childId) => serializeSubtree(childId, nodesById, childrenOf, depth + 1, query))
    .filter(Boolean)
    .join('\n')

  if (!matchesQuery(node, query)) return childrenXml
  return serializeNodeElement(node, childrenXml, depth)
}

/**
 * Serialize nodes/edges into an XML fragment (multiple top-level <node> = multiple roots).
 * Positions, edges and transient UI markers are never persisted (PRD 2.2).
 */
export function serializeTreeFragment(nodes: MindmapXmlNode[], edges: MindmapXmlEdge[]): string {
  return serializeMindmapSection(nodes, edges)
}

/**
 * Palace landing input: the subgraph payload (CONTEXT.md "subgraph output") minus the
 * kind/error envelope.
 */
interface PalaceNodePayload {
  label: string
  imageUrl: string
  stations: readonly unknown[]
  sourceNodeIds: readonly string[]
}

/**
 * Palace payload → XML fragment (deterministic landing: serialized by **code**;
 * the model never repeats the image data URL).
 *
 * The id is minted during serialization: the parser mints its own id for a
 * fragment that lacks one, and the landing side needs the same id; the node shape
 * reuses the palace registry writer, avoiding a second XML contract.
 */
export function serializePalaceNodeXml(input: PalaceNodePayload): string {
  const node = {
    id: newId(),
    type: 'palace',
    position: { x: 0, y: 0 },
    data: {
      label: input.label,
      imageUrl: input.imageUrl,
      stations: input.stations,
      sourceNodeIds: input.sourceNodeIds,
    },
  } as unknown as MindmapXmlNode
  return serializeNodeElement(node, '', 0)
}

/** Serialize a mindmap section subtree (readMindmap output / turn state). */
interface MindmapSectionQuery {
  subtreeId?: string
  type?: string
  textContains?: string
  maxDepth?: number
}

function matchesQuery(node: MindmapXmlNode, query: MindmapSectionQuery | undefined): boolean {
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
 * Serialize the mindmap section into an XML fragment (after tree-query filtering).
 * Filter semantics: subtree selection + type/content filtering + depth
 * truncation; only nodes carrying id/type/content/collapsed are emitted
 * (metadata/assets/documents never enter the context).
 */
export function serializeMindmapSection(
  nodes: MindmapXmlNode[],
  edges: MindmapXmlEdge[],
  query: MindmapSectionQuery = {},
): string {
  const nodesById = new Map(nodes.map((n) => [n.id, n]))
  const childrenOf = buildChildrenMap(nodes, edges)
  const roots = query.subtreeId ? [query.subtreeId] : findRootIds(nodes, edges)

  if (isFiltered(query) && !query.subtreeId && roots.length === 1) {
    // Filter query: keep the root chain; filtered-out intermediate nodes are replaced by their subtree content
    return serializeSubtree(roots[0]!, nodesById, childrenOf, 0, query)
  }
  return roots
    .map((rid) => serializeSubtree(rid, nodesById, childrenOf, 0, query))
    .filter(Boolean)
    .join('\n')
}

function isFiltered(query: MindmapSectionQuery): boolean {
  return (
    query.type !== undefined || query.textContains !== undefined || query.maxDepth !== undefined
  )
}

function textOf(value: string | undefined): string {
  return escapeXml(value ?? '')
}

/** Serialize the metadata section. */
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

/** Serialize the assets section. */
function serializeAssets(file: MindLaneFile): string {
  const assets = file.assets ?? []
  if (assets.length === 0) return `  <assets />`
  const lines = assets.map(
    (asset) =>
      `    <asset id="${textOf(asset.id)}" mime="${textOf(asset.mime)}" sha256="${textOf(asset.sha256)}">${asset.data}</asset>`,
  )
  return [`  <assets>`, ...lines, `  </assets>`].join('\n')
}

/** Serialize the documents section. */
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
 * Serialize the normalized file model into a complete XML document (single root
 * <mindlane version="1.0">). The version sits only on the root element;
 * position/edges/layout products are never persisted.
 */
export function serializeMindLaneFile(file: MindLaneFile): string {
  const nodesById = new Map(file.mindmap.nodes.map((n) => [n.id, n]))
  const childrenOf = buildChildrenMap(file.mindmap.nodes as MindmapXmlNode[], file.mindmap.edges)
  const roots = findRootIds(file.mindmap.nodes as MindmapXmlNode[], file.mindmap.edges)
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
