/**
 * 存量迁移转换器（纯函数）：JSON v1.0 文件模型 → XML v1.0。
 *
 * 与运行时 XML 序列化共用同一实现（serializeMindlaneFile）；输出确定性
 * （同一输入同一输出）。非树边丢弃并警告；URL 图片下载内嵌（失败保留 URL 并告警，
 * 仅迁移期例外）。文件系统扫描/下载由 runner 注入，本模块可单测。
 */

import type { MindLaneFile, MindLaneNode } from '../fileFormat.js'
import { migrateDocumentRef } from '../fileFormat.js'
import { newId } from '../mindmapTree.js'
import { serializeMindlaneFile } from './serializer.js'

export interface MigrationWarning {
  message: string
}

export interface MigrationOptions {
  /**
   * 下载图片 URL → base64（无 data: 前缀）。返回 null 表示下载失败
   * （失败路径保留 URL 并告警，仅迁移期例外）。
   */
  downloadImage?: (url: string) => Promise<{ mime: string; data: string } | null>
}

export interface MigrationResult {
  xml: string
  warnings: MigrationWarning[]
}

interface NodeDataLike {
  label?: string
  imageUrl?: string
  assetId?: string
  stations?: unknown[]
  sourceNodeIds?: string[]
  [key: string]: unknown
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

async function sha256Hex(data: string): Promise<string> {
  // 主进程/测试环境（Electron-as-Node）有 node:crypto；渲染层有 crypto.subtle
  const globalNode = globalThis as { require?: (id: string) => unknown }
  if (typeof globalNode.require === 'function') {
    const crypto = globalNode.require('node:crypto') as {
      createHash: (alg: string) => { update: (d: string) => { digest: (enc: string) => string } }
    }
    return crypto.createHash('sha256').update(data).digest('hex')
  }
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const bytes = new TextEncoder().encode(data)
    const digest = await subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return ''
}

/** 把 JSON 模型重建为纯树：丢弃非树边（多父/环），多余根挂到主根下。 */
function rebuildTree(
  nodes: MindLaneNode[],
  edges: Array<{ id: string; source: string; target: string }>,
  warnings: MigrationWarning[],
): { nodes: MindLaneNode[]; edges: Array<{ id: string; source: string; target: string }> } {
  const nodeIds = new Set(nodes.map((n) => n.id))

  // 1. 每个目标只保留第一条入边（多父 → 非树边丢弃）
  const keptEdges: Array<{ id: string; source: string; target: string }> = []
  const incoming = new Map<string, Array<{ id: string; source: string; target: string }>>()
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      warnings.push({
        message: `丢弃边 ${edge.id}（${edge.source} → ${edge.target}）：引用不存在的节点`,
      })
      continue
    }
    const list = incoming.get(edge.target) ?? []
    list.push(edge)
    incoming.set(edge.target, list)
  }
  for (const [target, list] of incoming) {
    keptEdges.push(list[0]!)
    for (const extra of list.slice(1)) {
      warnings.push({
        message: `丢弃非树边 ${extra.id}（${extra.source} → ${target}）：节点 ${target} 已有父节点，纯树不允许多父`,
      })
    }
  }

  // 2. 环检测：从每条边出发沿出边走，回到自身即环 → 丢弃闭环边
  const childrenOf = new Map<string, string[]>()
  for (const edge of keptEdges) {
    const list = childrenOf.get(edge.source) ?? []
    list.push(edge.target)
    childrenOf.set(edge.source, list)
  }
  const acyclicEdges: typeof keptEdges = []
  for (const edge of keptEdges) {
    // 从 edge.target 出发能否回到 edge.source（形成环）？
    const stack = [...(childrenOf.get(edge.target) ?? [])]
    const visited = new Set<string>()
    let formsCycle = false
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current === edge.source) {
        formsCycle = true
        break
      }
      if (visited.has(current)) continue
      visited.add(current)
      for (const child of childrenOf.get(current) ?? []) stack.push(child)
    }
    if (formsCycle) {
      warnings.push({
        message: `丢弃环边 ${edge.id}（${edge.source} → ${edge.target}）：导图必须是纯树`,
      })
    } else {
      acyclicEdges.push(edge)
    }
  }

  // 3. 多根 → 附加根挂到主根下（内容保留，结构微调并告警）
  const incomingAfter = new Set(acyclicEdges.map((e) => e.target))
  const roots = nodes.filter((n) => !incomingAfter.has(n.id))
  const mainRoot = roots.find((n) => n.id === 'root') ?? roots[0]
  if (!mainRoot) {
    warnings.push({ message: '未找到根节点，将第一个节点作为根' })
  }
  const extraRoots = roots.filter((r) => r !== mainRoot)
  for (const extra of extraRoots) {
    warnings.push({
      message: `节点 ${extra.id} 没有父节点（历史任意连线产物），已作为「${mainRoot?.id ?? 'root'}」的子节点挂载`,
    })
    acyclicEdges.push({
      id: `e-migrate-${mainRoot?.id ?? 'root'}-${extra.id}`,
      source: mainRoot?.id ?? 'root',
      target: extra.id,
    })
  }

  return { nodes, edges: acyclicEdges }
}

/**
 * 转换 JSON v1.0 文件模型 → XML v1.0 字符串。
 * 输出确定性：同一输入 + 同一 downloadImage 行为 → 同一输出。
 */
export async function migrateJsonFileToXml(
  raw: unknown,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const warnings: MigrationWarning[] = []
  const json = raw as Partial<MindLaneFile> & { mindmap?: Partial<MindLaneFile['mindmap']> }

  if (!json.mindmap || !Array.isArray(json.mindmap.nodes)) {
    throw new Error('文件结构不正确：缺少 mindmap.nodes')
  }

  const { nodes, edges } = rebuildTree(
    json.mindmap.nodes as MindLaneNode[],
    (json.mindmap.edges ?? []) as Array<{ id: string; source: string; target: string }>,
    warnings,
  )

  // 图片 URL 下载内嵌（palace.imageUrl；失败保留 URL 并告警，仅迁移期例外）
  const assets: MindLaneFile['assets'] = []
  const assetByUrl = new Map<string, string>()
  const assetBySha = new Map<string, string>()

  const downloadAndEmbed = async (data: NodeDataLike): Promise<void> => {
    if (!isHttpUrl(data.imageUrl) || !options.downloadImage) return
    const cached = assetByUrl.get(data.imageUrl)
    if (cached) {
      data.assetId = cached
      data.imageUrl = ''
      return
    }
    try {
      const downloaded = await options.downloadImage(data.imageUrl)
      if (!downloaded) {
        warnings.push({ message: `图片下载失败，保留 URL（迁移期例外）：${data.imageUrl}` })
        return
      }
      const sha = await sha256Hex(downloaded.data)
      const existing = assetBySha.get(sha)
      if (existing) {
        data.assetId = existing
      } else {
        const assetId = newId()
        const asset = { id: assetId, mime: downloaded.mime, sha256: sha, data: downloaded.data }
        assets.push(asset)
        assetBySha.set(sha, assetId)
        data.assetId = assetId
      }
      assetByUrl.set(data.imageUrl, data.assetId)
      data.imageUrl = ''
    } catch {
      warnings.push({ message: `图片下载失败，保留 URL（迁移期例外）：${data.imageUrl}` })
    }
  }

  for (const node of nodes) {
    const data = node.data as NodeDataLike
    if (isHttpUrl(data.imageUrl)) {
      await downloadAndEmbed(data)
    }
  }

  const now = new Date().toISOString()
  const metadata = (json.metadata ?? {}) as Record<string, unknown>

  // 旧文件样式可能在 metadata.mindmapStyle（历史形态）→ 提升到 mindmap.style
  const legacyStyle = metadata.mindmapStyle as
    { structureType?: string; visualVariant?: string; colorScheme?: string } | undefined
  const style = (json.mindmap.style ??
    (legacyStyle && typeof legacyStyle === 'object'
      ? {
          structureType: legacyStyle.structureType === 'mindmap' ? 'mindmap' : 'logic',
          visualVariant:
            legacyStyle.visualVariant === 'card' ||
            legacyStyle.visualVariant === 'outline' ||
            legacyStyle.visualVariant === 'minimal'
              ? legacyStyle.visualVariant
              : 'card',
          colorScheme: legacyStyle.colorScheme ?? 'default',
        }
      : undefined)) as MindLaneFile['mindmap']['style'] | undefined
  const file: MindLaneFile = {
    version: '1.0',
    metadata: {
      fileUuid: typeof metadata.fileUuid === 'string' ? metadata.fileUuid : cryptoRandomUuid(),
      title: typeof metadata.title === 'string' ? metadata.title : '未命名',
      createdAt: typeof metadata.createdAt === 'string' ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'string' ? metadata.updatedAt : now,
    },
    mindmap: {
      nodes,
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'mindmap',
      })),
      viewport:
        json.mindmap.viewport && typeof json.mindmap.viewport === 'object'
          ? {
              x: Number((json.mindmap.viewport as { x?: unknown }).x) || 0,
              y: Number((json.mindmap.viewport as { y?: unknown }).y) || 0,
              zoom: Number((json.mindmap.viewport as { zoom?: unknown }).zoom) || 1,
            }
          : { x: 0, y: 0, zoom: 1 },
      ...(style ? { style } : {}),
    },
    assets,
    documents: (json.documents ?? []).map((doc) => migrateDocumentRef(doc)),
  }

  return { xml: serializeMindlaneFile(file), warnings }
}

function cryptoRandomUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `migrate-${Date.now()}`
}
