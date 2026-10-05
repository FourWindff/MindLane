/**
 * Node type registry (mindmapXml side): typeId / name / description / XML shape contract.
 *
 * Each type carries its own writer (ReactFlow Node → XML attributes) and reader
 * (XML attributes + type-specific child elements → NodeData). Adding a node type
 * = registering one entry (PRD 3.3), with the tool set and core pipeline
 * untouched; the descriptions are injected into the system prompt's stable prefix
 * via `describeNodeTypes()` (issue 06).
 */

import { escapeXml } from './escape.js'
import type { MindmapXmlNode, XmlElementLike } from './types.js'

interface XmlNodeReaderContext {
  /** XML attributes (lowercase keys, entities already unescaped) */
  attrs: Record<string, string>
  /** Type-specific child elements (excluding <node> tree children; text is trimmed) */
  elements: XmlElementLike[]
}

/**
 * Read an attribute case-insensitively: `elementView` stores both the original
 * name and a lowercase key for every attribute, so an "exact + lowercase"
 * double lookup is enough (XML is case-sensitive; the HTML parser lowercases).
 */
export function attrOf(attrs: Record<string, string>, name: string): string | undefined {
  return attrs[name] ?? attrs[name.toLowerCase()]
}

interface XmlNodeTypeDescriptor {
  typeId: string
  /** Display name (injected into the system prompt) */
  name: string
  /** Semantics and purpose description (injected into the system prompt) */
  description: string
  /** Node → XML attributes. Excludes id/type/collapsed (handled by the generic layer). */
  write(node: MindmapXmlNode): Record<string, string | undefined>
  /** Type-specific child element XML (e.g. palace's <station>). Empty string = none. */
  writeChildren?(node: MindmapXmlNode): string
  /** XML attributes + specific child elements → ReactFlow NodeData. */
  read(ctx: XmlNodeReaderContext): Record<string, unknown>
}

const descriptors = new Map<string, XmlNodeTypeDescriptor>()

/** Register (or override) a node type: three built-ins; a new type = one more entry here. */
function register(descriptor: XmlNodeTypeDescriptor): void {
  descriptors.set(descriptor.typeId, descriptor)
}

export const xmlNodeTypeRegistry = {
  get(typeId: string): XmlNodeTypeDescriptor | undefined {
    return descriptors.get(typeId)
  },

  /** name/description/shape contract of all types, injected into the system prompt's stable prefix. */
  describeAll(): string {
    return [...descriptors.values()]
      .map(
        (d) =>
          `- ${d.typeId} (${d.name}): ${d.description}; for the XML shape see the type validation rules (the type attribute is required; unknown types report invalid_type)`,
      )
      .join('\n')
  },
}

// ─── text ────────────────────────────────────────────────────────────────────

register({
  typeId: 'text',
  name: 'Text node',
  description:
    'Basic mindmap node; the content attribute holds plain-text content (the only content channel); example <node type="text" content="Title" />',
  write(node) {
    const data = node.data as Record<string, unknown>
    return {
      content: typeof data.label === 'string' ? data.label : '',
      ...(typeof data.pageRange === 'string' && { pageRange: data.pageRange }),
      ...(typeof data.summary === 'string' && { summary: data.summary }),
      ...(typeof data.palaceId === 'string' && { palaceId: data.palaceId }),
    }
  },
  read({ attrs }) {
    const data: Record<string, unknown> = { label: attrOf(attrs, 'content') ?? '' }
    const pageRange = attrOf(attrs, 'pageRange')
    if (pageRange !== undefined) data.pageRange = pageRange
    const summary = attrOf(attrs, 'summary')
    if (summary !== undefined) data.summary = summary
    const palaceId = attrOf(attrs, 'palaceId')
    if (palaceId !== undefined) data.palaceId = palaceId
    return data
  },
})

// ─── image ───────────────────────────────────────────────────────────────────

register({
  typeId: 'image',
  name: 'Image node',
  description:
    'Node showing an embedded image; the asset attribute references a resource id in the <assets> section (must come from context; external URLs are disabled); optional alt/width/height; example <node type="image" asset="a1" alt="Architecture diagram" width="400" />',
  write(node) {
    const data = node.data as Record<string, unknown>
    return {
      asset: typeof data.assetId === 'string' ? data.assetId : '',
      ...(typeof data.alt === 'string' && { alt: data.alt }),
      ...(typeof data.width === 'number' && { width: String(data.width) }),
      ...(typeof data.height === 'number' && { height: String(data.height) }),
    }
  },
  read({ attrs }) {
    const data: Record<string, unknown> = { assetId: attrOf(attrs, 'asset') ?? '' }
    const alt = attrOf(attrs, 'alt')
    if (alt !== undefined) data.alt = alt
    const width = attrOf(attrs, 'width')
    if (width !== undefined) data.width = Number(width) || undefined
    const height = attrOf(attrs, 'height')
    if (height !== undefined) data.height = Number(height) || undefined
    return data
  },
})

// ─── palace ──────────────────────────────────────────────────────────────────

register({
  typeId: 'palace',
  name: 'Memory palace node',
  description:
    'Memory palace: content is the palace name and asset references the palace image; stations are expressed as <station order="1" x="0" y="0" linkedNodeId="n1" anchorVisual="…" association="…">memory content</station> child elements; example <node type="palace" content="Palace name" asset="a1"><station order="1" linkedNodeId="n1">content</station></node>',
  write(node) {
    const data = node.data as Record<string, unknown>
    const attrs: Record<string, string | undefined> = {
      content: typeof data.label === 'string' ? data.label : '',
    }
    if (typeof data.assetId === 'string' && data.assetId) {
      attrs.asset = data.assetId
    } else if (typeof data.imageUrl === 'string' && data.imageUrl) {
      // Migration-period exception (PRD 7): old URL images whose download failed keep
      // their reference; allowed only during migration.
      attrs.imageUrl = data.imageUrl
    }
    if (Array.isArray(data.sourceNodeIds) && data.sourceNodeIds.length > 0) {
      attrs.sourceNodeIds = (data.sourceNodeIds as string[]).join(',')
    }
    return attrs
  },
  writeChildren(node) {
    const data = node.data as Record<string, unknown>
    const stations = Array.isArray(data.stations)
      ? (data.stations as Array<Record<string, unknown>>)
      : []
    const lines = stations.map((s) => {
      const attrs = [
        ['order', String(s.order ?? 0)],
        ['x', String(s.x ?? 0)],
        ['y', String(s.y ?? 0)],
        ...(typeof s.linkedNodeId === 'string' && s.linkedNodeId
          ? ([['linkedNodeId', s.linkedNodeId]] as const)
          : []),
        ...(typeof s.anchorVisual === 'string' && s.anchorVisual
          ? ([['anchorVisual', s.anchorVisual]] as const)
          : []),
        ...(typeof s.association === 'string' && s.association
          ? ([['association', s.association]] as const)
          : []),
      ] as const
      const attrText = attrs.map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`).join('')
      return `      <station${attrText}>${escapeXml(String(s.content ?? ''))}</station>`
    })
    return lines.join('\n')
  },
  read({ attrs, elements }) {
    const data: Record<string, unknown> = { label: attrOf(attrs, 'content') ?? '' }
    const asset = attrOf(attrs, 'asset')
    if (asset !== undefined) data.assetId = asset
    const imageUrl = attrOf(attrs, 'imageUrl')
    if (imageUrl !== undefined) data.imageUrl = imageUrl
    const sourceNodeIds = attrOf(attrs, 'sourceNodeIds')
    if (sourceNodeIds !== undefined) {
      data.sourceNodeIds = sourceNodeIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    data.stations = elements
      .filter((e) => e.tag === 'station')
      .map((e) => ({
        order: Number(attrOf(e.attrs, 'order')) || 0,
        content: e.text,
        anchorVisual: attrOf(e.attrs, 'anchorVisual') ?? '',
        ...(attrOf(e.attrs, 'association') !== undefined && {
          association: attrOf(e.attrs, 'association'),
        }),
        x: Number(attrOf(e.attrs, 'x')) || 0,
        y: Number(attrOf(e.attrs, 'y')) || 0,
        linkedNodeId: attrOf(e.attrs, 'linkedNodeId') ?? '',
      }))
    return data
  },
})

// ─── Shared utilities ────────────────────────────────────────────────────────────────
