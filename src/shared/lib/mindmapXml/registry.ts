/**
 * 节点类型注册表（mindmapXml 侧）：typeId / name / description / XML 形状契约。
 *
 * 每类型自带 writer（ReactFlow Node → XML 属性）与 reader（XML 属性 + 类型专属
 * 子元素 → NodeData）。新增节点类型 = 注册一条目（PRD 3.3），工具集与核心管线不动；
 * 描述经 `describeNodeTypes()` 注入系统提示稳定前缀（issue 06）。
 */

import type { Node } from '@xyflow/react'
import { escapeXml } from './escape.js'
import type { MindlaneAsset, XmlElementLike } from './types.js'

export interface XmlNodeReaderContext {
  /** XML 属性（键小写，实体已反转义） */
  attrs: Record<string, string>
  /** 类型专属子元素（不含 <node> 树子节点，text 已去空白） */
  elements: XmlElementLike[]
}

/** 大小写不敏感地读取属性（XML 属性名区分大小写，HTML parser 会小写化）。 */
export function attrOf(attrs: Record<string, string>, name: string): string | undefined {
  if (attrs[name] !== undefined) return attrs[name]
  const lower = name.toLowerCase()
  const key = Object.keys(attrs).find((k) => k.toLowerCase() === lower)
  return key ? attrs[key] : undefined
}

export interface XmlNodeTypeDescriptor {
  typeId: string
  /** 展示名（注入系统提示） */
  name: string
  /** 语义与用途描述（注入系统提示） */
  description: string
  /** ReactFlow Node → XML 属性。不含 id/type/collapsed（通用层处理）。 */
  write(node: Node): Record<string, string | undefined>
  /** 类型专属子元素 XML（如 palace 的 <station>）。空字符串 = 无。 */
  writeChildren?(node: Node): string
  /** XML 属性 + 专属子元素 → ReactFlow NodeData。 */
  read(ctx: XmlNodeReaderContext): Record<string, unknown>
}

class XmlNodeTypeRegistry {
  private descriptors = new Map<string, XmlNodeTypeDescriptor>()

  register(descriptor: XmlNodeTypeDescriptor): void {
    this.descriptors.set(descriptor.typeId, descriptor)
  }

  get(typeId: string): XmlNodeTypeDescriptor | undefined {
    return this.descriptors.get(typeId)
  }

  has(typeId: string): boolean {
    return this.descriptors.has(typeId)
  }

  all(): XmlNodeTypeDescriptor[] {
    return [...this.descriptors.values()]
  }

  /** 全部类型的 name/description/形状契约，注入系统提示稳定前缀。 */
  describeAll(): string {
    return this.all()
      .map(
        (d) =>
          `- ${d.typeId}（${d.name}）：${d.description}；XML 形状见类型校验规则（type 属性必填，未知类型报 invalid_type）`,
      )
      .join('\n')
  }
}

export const xmlNodeTypeRegistry = new XmlNodeTypeRegistry()

// ─── text ────────────────────────────────────────────────────────────────────

xmlNodeTypeRegistry.register({
  typeId: 'text',
  name: '文本节点',
  description:
    '导图的基本节点，content 属性为纯文本内容（唯一内容通道）；示例 <node type="text" content="标题" />',
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

xmlNodeTypeRegistry.register({
  typeId: 'image',
  name: '图片节点',
  description:
    '展示内嵌图片的节点，asset 属性引用 <assets> 节中的资源 id（必须来自上下文，禁用外部 URL）；可选 alt/width/height；示例 <node type="image" asset="a1" alt="架构图" width="400" />',
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

xmlNodeTypeRegistry.register({
  typeId: 'palace',
  name: '记忆宫殿节点',
  description:
    '记忆宫殿：content 为宫殿名，asset 引用宫殿图片资源；站点以 <station order="1" x="0" y="0" linkedNodeId="n1" anchorVisual="…" association="…">记忆内容</station> 子元素表达；示例 <node type="palace" content="宫殿名" asset="a1"><station order="1" linkedNodeId="n1">内容</station></node>',
  write(node) {
    const data = node.data as Record<string, unknown>
    const attrs: Record<string, string | undefined> = {
      content: typeof data.label === 'string' ? data.label : '',
    }
    if (typeof data.assetId === 'string' && data.assetId) {
      attrs.asset = data.assetId
    } else if (typeof data.imageUrl === 'string' && data.imageUrl) {
      // 迁移期例外（PRD 7）：下载失败的旧 URL 图片保留引用，仅迁移期允许。
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

// ─── 通用工具 ────────────────────────────────────────────────────────────────

export type { MindlaneAsset }
