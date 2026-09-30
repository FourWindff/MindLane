/**
 * Persisted node data shapes: part of the `.mindlane` file format, not UI-only
 * types, so both processes read the same definition. Transient UI markers may
 * ride along (they are never serialized; see the node descriptors).
 */

import type { PalaceStationPayload } from './palace.js'

export type TextNodeData = {
  label: string
  palaceId?: string
  pageRange?: string
  summary?: string
  /** 通用折叠属性：折叠该节点后的整棵子树；缺省展开，只影响展示 */
  collapsed?: boolean
  /** Root-only, bilateral layout: collapse the root's left branch (direct left children and their subtrees); expanded by default */
  leftCollapsed?: boolean
  /** Root-only, bilateral layout: collapse the root's right branch (direct right children and their subtrees); expanded by default */
  rightCollapsed?: boolean
  justAdded?: boolean
  /** Agent write-path cascade enter delay (ms); present iff the node came from an agent write tool. Transient, never persisted. */
  cascadeDelay?: number
  exiting?: boolean
  /** Reverse-cascade exit delay (ms); leaves exit first, parent last. Transient, never persisted. */
  exitingDelay?: number
  /** Gliding (moveSubtree moved this subtree); pairs with glideFrom for the position transition. Transient, never persisted. */
  gliding?: boolean
  /** Glide origin (old position); the view derives the transition offset from it. Transient, never persisted. */
  glideFrom?: { x: number; y: number }
  editing?: boolean
  processing?: boolean
  /** 节点在树中的深度：0=根节点，1=根的直接子节点，以此类推。由布局算法写入。 */
  depth?: number
  /** 所属分支的索引（从根节点第几个子节点的子树中继承）。根节点为 -1。由布局算法写入。 */
  branchIndex?: number
  /** 思维导图布局中节点所在的一侧。由布局算法写入并持久化，保证重新布局时分侧稳定。 */
  side?: 'left' | 'right'
}

/** 图片节点数据：经 asset 引用内嵌图片（禁用外部 URL）。 */
export type ImageNodeData = {
  /** <assets> 节中的资源 id */
  assetId: string
  alt?: string
  width?: number
  height?: number
  collapsed?: boolean
  justAdded?: boolean
  exiting?: boolean
  /** 布局产物（不落盘，打开时重算） */
  depth?: number
  branchIndex?: number
  side?: 'left' | 'right'
}

export type PalaceNodeData = {
  label: string
  /** 内嵌图片资源 id（<assets> 节）；迁移期下载失败的旧文件保留 imageUrl */
  assetId?: string
  imageUrl: string
  stations: PalaceStation[]
  sourceNodeIds: string[]
  expanded?: boolean
  generating?: boolean
  /** Live manual-run stage label (transient, never persisted). */
  runStage?: string
  /** Manual run stopped or failed: the node keeps its placeholder and offers 继续. */
  runStopped?: boolean
}

/** Palace stations are the landing payload's stations — the node stores that payload. */
export type PalaceStation = PalaceStationPayload
