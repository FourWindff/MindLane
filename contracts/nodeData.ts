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
  /** Generic collapse flag: collapses the whole subtree after this node; expanded by default, display-only */
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
  /** Depth of the node in the tree: 0=root node, 1=root's direct child, and so on. Written by the layout algorithm. */
  depth?: number
  /** Index of the owning branch (inherited from the subtree of the root's n-th child). -1 for the root node. Written by the layout algorithm. */
  branchIndex?: number
  /** Side the node sits on in the mindmap layout. Written by the layout algorithm and persisted so re-layout keeps sides stable. */
  side?: 'left' | 'right'
}

/** Image node data: references an embedded image via asset (external URLs are disabled). */
export type ImageNodeData = {
  /** Asset id in the <assets> section */
  assetId: string
  alt?: string
  width?: number
  height?: number
  collapsed?: boolean
  justAdded?: boolean
  exiting?: boolean
  /** Layout product (not persisted; recomputed on open) */
  depth?: number
  branchIndex?: number
  side?: 'left' | 'right'
}

export type PalaceNodeData = {
  label: string
  /** Embedded image asset id (<assets> section); old files whose download failed keep imageUrl during migration */
  assetId?: string
  imageUrl: string
  stations: PalaceStation[]
  sourceNodeIds: string[]
  expanded?: boolean
  generating?: boolean
  /** Live manual-run stage label (transient, never persisted). */
  runStage?: string
  /** Manual run stopped or failed: the node keeps its placeholder and offers Resume. */
  runStopped?: boolean
}

/** Palace stations are the landing payload's stations — the node stores that payload. */
export type PalaceStation = PalaceStationPayload
