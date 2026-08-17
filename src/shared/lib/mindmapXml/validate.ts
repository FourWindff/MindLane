/**
 * 编辑器侧校验（insertFromXml / updateMindmapNode 共用）：
 * 把解析后的片段对照编辑器活状态做存在性/纯树/asset 引用校验。
 *
 * 校验失败抛 MindmapXmlError，错误码回传给 AI（PRD 5.4）。
 * 任何失败都不产生部分挂载——调用方必须整体拒绝。
 */

import { MindmapXmlError } from './types.js'
import type { ParsedFragment } from './deserializer.js'

export interface EditorValidationContext {
  /** 编辑器当前全部节点 id（含 root） */
  nodeIds: Set<string>
  /** 编辑器当前 asset id 集合 */
  assetIds: Set<string>
}

function collectNodeIds(fragment: ParsedFragment): Set<string> {
  return new Set(fragment.nodes.map((n) => n.id))
}

function collectAssetRefs(fragment: ParsedFragment): string[] {
  const refs: string[] = []
  for (const node of fragment.nodes) {
    const data = node.data as Record<string, unknown>
    if (typeof data.assetId === 'string' && data.assetId) refs.push(data.assetId)
  }
  return refs
}

/**
 * insertXmlFragment 校验：片段中的 id 不得与编辑器现有节点冲突
 * （冲突 = 多父/重复子树 → tree_invalid）；asset 引用必须存在 → asset_not_found。
 * `excludeIds`：整体替换场景（updateMindmapNode）中被替换节点自身及其旧子树除外。
 */
export function validateFragmentForInsert(
  fragment: ParsedFragment,
  ctx: EditorValidationContext,
  excludeIds: Set<string> = new Set(),
): void {
  for (const id of collectNodeIds(fragment)) {
    if (ctx.nodeIds.has(id) && !excludeIds.has(id)) {
      throw new MindmapXmlError(
        'tree_invalid',
        `节点 id「${id}」已存在于导图中（纯树不允许重复 id，否则产生多父/环）`,
      )
    }
  }
  for (const assetId of collectAssetRefs(fragment)) {
    if (!ctx.assetIds.has(assetId)) {
      throw new MindmapXmlError(
        'asset_not_found',
        `引用不存在的图片资源「${assetId}」（asset 必须来自上下文）`,
      )
    }
  }
}

/**
 * moveMindmapNode 校验：目标 id 存在性、root 不可移动、目标不得位于被移子树内（环）。
 */
export function validateMove(
  nodeId: string,
  targetId: string,
  ctx: { nodeIds: Set<string>; childrenOf: Map<string, string[]> },
): void {
  if (nodeId === 'root') {
    throw new MindmapXmlError('tree_invalid', 'root 是导图锚点，不可移动')
  }
  if (!ctx.nodeIds.has(nodeId)) {
    throw new MindmapXmlError(
      'block_not_found',
      `节点「${nodeId}」不存在，请先 readMindmap 重新定位`,
    )
  }
  if (targetId === nodeId) {
    throw new MindmapXmlError('tree_invalid', '目标节点不能是自身')
  }
  if (!ctx.nodeIds.has(targetId)) {
    throw new MindmapXmlError(
      'block_not_found',
      `目标节点「${targetId}」不存在，请先 readMindmap 重新定位`,
    )
  }
  // 环检测：targetId 不得位于 nodeId 的子树内（否则 nodeId 成为自身后代的子节点）
  const stack = [...(ctx.childrenOf.get(nodeId) ?? [])]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === targetId) {
      throw new MindmapXmlError('tree_invalid', `不能把节点移动到它自己的子树内（会产生环）`)
    }
    if (visited.has(current)) continue
    visited.add(current)
    for (const child of ctx.childrenOf.get(current) ?? []) stack.push(child)
  }
}

/**
 * 从节点/边/资源构建校验上下文（编辑器 Node[] 或快照形状均可）。
 */
export function buildValidationContext(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>,
  assets: Array<{ id: string }>,
): { ctx: EditorValidationContext; childrenOf: Map<string, string[]> } {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const assetIds = new Set(assets.map((a) => a.id))
  const childrenOf = new Map<string, string[]>()
  for (const edge of edges) {
    const list = childrenOf.get(edge.source)
    if (list) list.push(edge.target)
    else childrenOf.set(edge.source, [edge.target])
  }
  return { ctx: { nodeIds, assetIds }, childrenOf }
}
