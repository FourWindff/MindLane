import type { ColorSchemeId } from './types'

/** 单个颜色层级：对应节点的某个深度级别 */
export interface DepthColor {
  nodeBg: string
  nodeBorder: string
  nodeText: string
}

/** 单条分支的颜色：root子节点（depth1）→ 孙节点（depth2）→ 更深（depth3+） */
export interface BranchPalette {
  depth1: DepthColor
  depth2: DepthColor
  depth3: DepthColor // depth≥3 复用此层
}

/** 一套配色方案的完整定义 */
export interface SchemePalette {
  /** 画布背景色 */
  /** 画布点阵颜色 */
  /** 根节点样式（depth=0，不参与分支着色） */
  root: { nodeBg: string; nodeBorder: string; nodeText: string }
  /** 各分支配色，按 branchIndex % 6 循环使用 */
  branches: BranchPalette[]
}

// ─── 各方案调色板 ─────────────────────────────────────────────────────────────
const DEFAULT_GRAY: SchemePalette = {
  root: { nodeBg: '#ffffff', nodeBorder: '#b1b1b7', nodeText: '#222222' },
  branches: [
    {
      depth1: { nodeBg: '#ffffff', nodeBorder: '#b1b1b7', nodeText: '#333333' },
      depth2: { nodeBg: '#ffffff', nodeBorder: '#c3c3c8', nodeText: '#444444' },
      depth3: { nodeBg: '#ffffff', nodeBorder: '#d4d4d8', nodeText: '#555555' },
    },
  ],
}

const RAINBOW: SchemePalette = {
  root: { nodeBg: '#ffffff', nodeBorder: '#d1d5db', nodeText: '#111827' },
  branches: [
    {
      depth1: { nodeBg: '#fee2e2', nodeBorder: '#f87171', nodeText: '#7f1d1d' },
      depth2: { nodeBg: '#fff1f1', nodeBorder: '#fca5a5', nodeText: '#991b1b' },
      depth3: { nodeBg: '#fff8f8', nodeBorder: '#fecaca', nodeText: '#b91c1c' },
    },
    {
      depth1: { nodeBg: '#ffedd5', nodeBorder: '#fb923c', nodeText: '#7c2d12' },
      depth2: { nodeBg: '#fff7ed', nodeBorder: '#fdba74', nodeText: '#9a3412' },
      depth3: { nodeBg: '#fffbf5', nodeBorder: '#fed7aa', nodeText: '#c2410c' },
    },
    {
      depth1: { nodeBg: '#fef9c3', nodeBorder: '#facc15', nodeText: '#713f12' },
      depth2: { nodeBg: '#fefce8', nodeBorder: '#fde047', nodeText: '#854d0e' },
      depth3: { nodeBg: '#fffef0', nodeBorder: '#fef08a', nodeText: '#a16207' },
    },
    {
      depth1: { nodeBg: '#dcfce7', nodeBorder: '#4ade80', nodeText: '#14532d' },
      depth2: { nodeBg: '#f0fdf4', nodeBorder: '#86efac', nodeText: '#166534' },
      depth3: { nodeBg: '#f7fff9', nodeBorder: '#bbf7d0', nodeText: '#15803d' },
    },
    {
      depth1: { nodeBg: '#dbeafe', nodeBorder: '#3b82f6', nodeText: '#1e3a5f' },
      depth2: { nodeBg: '#eff6ff', nodeBorder: '#93c5fd', nodeText: '#1d4ed8' },
      depth3: { nodeBg: '#f5f9ff', nodeBorder: '#bfdbfe', nodeText: '#2563eb' },
    },
    {
      depth1: { nodeBg: '#ede9fe', nodeBorder: '#8b5cf6', nodeText: '#4c1d95' },
      depth2: { nodeBg: '#f5f3ff', nodeBorder: '#a78bfa', nodeText: '#5b21b6' },
      depth3: { nodeBg: '#fafaff', nodeBorder: '#c4b5fd', nodeText: '#6d28d9' },
    },
  ],
}

const WARM: SchemePalette = {
  root: { nodeBg: '#ffffff', nodeBorder: '#d1cec9', nodeText: '#2d2a26' },
  branches: [
    {
      depth1: { nodeBg: '#fde8e8', nodeBorder: '#f4a0a0', nodeText: '#6b1515' },
      depth2: { nodeBg: '#fff0f0', nodeBorder: '#fac9c9', nodeText: '#8b2020' },
      depth3: { nodeBg: '#fff8f8', nodeBorder: '#fde2e2', nodeText: '#9b3030' },
    },
    {
      depth1: { nodeBg: '#fef3e2', nodeBorder: '#f9c056', nodeText: '#5a3a00' },
      depth2: { nodeBg: '#fffaee', nodeBorder: '#fbd98a', nodeText: '#6b4800' },
      depth3: { nodeBg: '#fffdf5', nodeBorder: '#fdedb3', nodeText: '#7a5500' },
    },
    {
      depth1: { nodeBg: '#e8f5e9', nodeBorder: '#81c784', nodeText: '#1b5e20' },
      depth2: { nodeBg: '#f1faf1', nodeBorder: '#aed6af', nodeText: '#2e7d32' },
      depth3: { nodeBg: '#f7fdf7', nodeBorder: '#c8e6c9', nodeText: '#388e3c' },
    },
    {
      depth1: { nodeBg: '#e3f2fd', nodeBorder: '#64b5f6', nodeText: '#0d47a1' },
      depth2: { nodeBg: '#eff8ff', nodeBorder: '#90caf9', nodeText: '#1565c0' },
      depth3: { nodeBg: '#f5fbff', nodeBorder: '#bbdefb', nodeText: '#1976d2' },
    },
    {
      depth1: { nodeBg: '#f3e5f5', nodeBorder: '#ba68c8', nodeText: '#4a148c' },
      depth2: { nodeBg: '#f9f0fb', nodeBorder: '#ce93d8', nodeText: '#6a1b9a' },
      depth3: { nodeBg: '#fcf5fd', nodeBorder: '#e1bee7', nodeText: '#7b1fa2' },
    },
    {
      depth1: { nodeBg: '#fce4ec', nodeBorder: '#f06292', nodeText: '#880e4f' },
      depth2: { nodeBg: '#fef0f5', nodeBorder: '#f48fb1', nodeText: '#ad1457' },
      depth3: { nodeBg: '#fff5f8', nodeBorder: '#f8bbd0', nodeText: '#c2185b' },
    },
  ],
}

const OCEAN: SchemePalette = {
  root: { nodeBg: '#ffffff', nodeBorder: '#b0d4ec', nodeText: '#0d2d45' },
  branches: [
    {
      depth1: { nodeBg: '#dbeafe', nodeBorder: '#3b82f6', nodeText: '#1e3a5f' },
      depth2: { nodeBg: '#eff6ff', nodeBorder: '#93c5fd', nodeText: '#1d4ed8' },
      depth3: { nodeBg: '#f5f9ff', nodeBorder: '#bfdbfe', nodeText: '#2563eb' },
    },
    {
      depth1: { nodeBg: '#ccfbf1', nodeBorder: '#14b8a6', nodeText: '#134e4a' },
      depth2: { nodeBg: '#e6fffa', nodeBorder: '#5eead4', nodeText: '#0f766e' },
      depth3: { nodeBg: '#f0fffd', nodeBorder: '#99f6e4', nodeText: '#0d9488' },
    },
    {
      depth1: { nodeBg: '#e0f2fe', nodeBorder: '#38bdf8', nodeText: '#075985' },
      depth2: { nodeBg: '#f0f9ff', nodeBorder: '#7dd3fc', nodeText: '#0284c7' },
      depth3: { nodeBg: '#f7fdff', nodeBorder: '#bae6fd', nodeText: '#0ea5e9' },
    },
    {
      depth1: { nodeBg: '#e0e7ff', nodeBorder: '#6366f1', nodeText: '#312e81' },
      depth2: { nodeBg: '#eef2ff', nodeBorder: '#a5b4fc', nodeText: '#3730a3' },
      depth3: { nodeBg: '#f5f7ff', nodeBorder: '#c7d2fe', nodeText: '#4338ca' },
    },
    {
      depth1: { nodeBg: '#d1fae5', nodeBorder: '#34d399', nodeText: '#064e3b' },
      depth2: { nodeBg: '#ecfdf5', nodeBorder: '#6ee7b7', nodeText: '#065f46' },
      depth3: { nodeBg: '#f3fef8', nodeBorder: '#a7f3d0', nodeText: '#047857' },
    },
    {
      depth1: { nodeBg: '#dde8f5', nodeBorder: '#5b8eb5', nodeText: '#1a3d5c' },
      depth2: { nodeBg: '#edf4f9', nodeBorder: '#8ab2ce', nodeText: '#2a5578' },
      depth3: { nodeBg: '#f4f9fc', nodeBorder: '#b0cfe3', nodeText: '#3a6e91' },
    },
  ],
}

const FOREST: SchemePalette = {
  root: { nodeBg: '#ffffff', nodeBorder: '#a8d5a2', nodeText: '#1a3320' },
  branches: [
    {
      depth1: { nodeBg: '#d1fae5', nodeBorder: '#34d399', nodeText: '#064e3b' },
      depth2: { nodeBg: '#ecfdf5', nodeBorder: '#6ee7b7', nodeText: '#065f46' },
      depth3: { nodeBg: '#f3fef8', nodeBorder: '#a7f3d0', nodeText: '#047857' },
    },
    {
      depth1: { nodeBg: '#ecfccb', nodeBorder: '#84cc16', nodeText: '#365314' },
      depth2: { nodeBg: '#f5ffd8', nodeBorder: '#bef264', nodeText: '#3f6212' },
      depth3: { nodeBg: '#fafff0', nodeBorder: '#d9f99d', nodeText: '#4d7c0f' },
    },
    {
      depth1: { nodeBg: '#ccfbf1', nodeBorder: '#14b8a6', nodeText: '#134e4a' },
      depth2: { nodeBg: '#e6fffa', nodeBorder: '#5eead4', nodeText: '#0f766e' },
      depth3: { nodeBg: '#f0fffd', nodeBorder: '#99f6e4', nodeText: '#0d9488' },
    },
    {
      depth1: { nodeBg: '#fef9c3', nodeBorder: '#ca8a04', nodeText: '#713f12' },
      depth2: { nodeBg: '#fefce8', nodeBorder: '#eab308', nodeText: '#854d0e' },
      depth3: { nodeBg: '#fffef5', nodeBorder: '#fde047', nodeText: '#92400e' },
    },
    {
      depth1: { nodeBg: '#dcfce7', nodeBorder: '#4ade80', nodeText: '#14532d' },
      depth2: { nodeBg: '#f0fdf4', nodeBorder: '#86efac', nodeText: '#166534' },
      depth3: { nodeBg: '#f7fff9', nodeBorder: '#bbf7d0', nodeText: '#15803d' },
    },
    {
      depth1: { nodeBg: '#f5f0eb', nodeBorder: '#a18067', nodeText: '#4a2f1a' },
      depth2: { nodeBg: '#faf7f4', nodeBorder: '#c4a98c', nodeText: '#5c3d22' },
      depth3: { nodeBg: '#fdfcfa', nodeBorder: '#ddc9b4', nodeText: '#6b4a2c' },
    },
  ],
}

const SUNSET: SchemePalette = {
  root: { nodeBg: '#ffffff', nodeBorder: '#e8bfa0', nodeText: '#3d1f0a' },
  branches: [
    {
      depth1: { nodeBg: '#ffedd5', nodeBorder: '#fb923c', nodeText: '#7c2d12' },
      depth2: { nodeBg: '#fff7ed', nodeBorder: '#fdba74', nodeText: '#9a3412' },
      depth3: { nodeBg: '#fffbf5', nodeBorder: '#fed7aa', nodeText: '#b45309' },
    },
    {
      depth1: { nodeBg: '#fee2e2', nodeBorder: '#f87171', nodeText: '#7f1d1d' },
      depth2: { nodeBg: '#fff2f2', nodeBorder: '#fca5a5', nodeText: '#991b1b' },
      depth3: { nodeBg: '#fff8f8', nodeBorder: '#fecaca', nodeText: '#b91c1c' },
    },
    {
      depth1: { nodeBg: '#fef9c3', nodeBorder: '#facc15', nodeText: '#713f12' },
      depth2: { nodeBg: '#fefce8', nodeBorder: '#fde047', nodeText: '#854d0e' },
      depth3: { nodeBg: '#fffef0', nodeBorder: '#fef08a', nodeText: '#92400e' },
    },
    {
      depth1: { nodeBg: '#fce7f3', nodeBorder: '#ec4899', nodeText: '#831843' },
      depth2: { nodeBg: '#fdf2f8', nodeBorder: '#f9a8d4', nodeText: '#9d174d' },
      depth3: { nodeBg: '#fef6fb', nodeBorder: '#fbcfe8', nodeText: '#be185d' },
    },
    {
      depth1: { nodeBg: '#fae9e2', nodeBorder: '#c2603a', nodeText: '#4a1505' },
      depth2: { nodeBg: '#fdf3ef', nodeBorder: '#d98a6d', nodeText: '#5c1e0a' },
      depth3: { nodeBg: '#fef9f7', nodeBorder: '#ecb8a3', nodeText: '#6d2a12' },
    },
    {
      depth1: { nodeBg: '#fef3c7', nodeBorder: '#d97706', nodeText: '#451a03' },
      depth2: { nodeBg: '#fffbeb', nodeBorder: '#f59e0b', nodeText: '#571e04' },
      depth3: { nodeBg: '#fffef7', nodeBorder: '#fcd34d', nodeText: '#6b2105' },
    },
  ],
}

const NIGHT: SchemePalette = {
  root: { nodeBg: '#252640', nodeBorder: '#4a4e7a', nodeText: '#e2e4f0' },
  branches: [
    {
      depth1: { nodeBg: '#2d2350', nodeBorder: '#7c5cbf', nodeText: '#d4bcf5' },
      depth2: { nodeBg: '#271e42', nodeBorder: '#6045a3', nodeText: '#c5a8f0' },
      depth3: { nodeBg: '#221a38', nodeBorder: '#4d3888', nodeText: '#b698e8' },
    },
    {
      depth1: { nodeBg: '#1e2d50', nodeBorder: '#4a7fbf', nodeText: '#b0d4f5' },
      depth2: { nodeBg: '#1a2642', nodeBorder: '#3d6aa3', nodeText: '#9ec5f0' },
      depth3: { nodeBg: '#162038', nodeBorder: '#325688', nodeText: '#8cb5e8' },
    },
    {
      depth1: { nodeBg: '#1a3040', nodeBorder: '#2a9d8f', nodeText: '#7ee8d8' },
      depth2: { nodeBg: '#162836', nodeBorder: '#208a7d', nodeText: '#6adcc8' },
      depth3: { nodeBg: '#12222e', nodeBorder: '#16756b', nodeText: '#56d0b8' },
    },
    {
      depth1: { nodeBg: '#3a1e3a', nodeBorder: '#c060b0', nodeText: '#f0b0e8' },
      depth2: { nodeBg: '#301830', nodeBorder: '#a84e9a', nodeText: '#e8a0d8' },
      depth3: { nodeBg: '#261226', nodeBorder: '#903e82', nodeText: '#e090c8' },
    },
    {
      depth1: { nodeBg: '#1a3025', nodeBorder: '#4caf50', nodeText: '#a0e8a8' },
      depth2: { nodeBg: '#16281e', nodeBorder: '#3d9c42', nodeText: '#8edc96' },
      depth3: { nodeBg: '#122018', nodeBorder: '#32883a', nodeText: '#7cd088' },
    },
    {
      depth1: { nodeBg: '#3a2810', nodeBorder: '#d4843c', nodeText: '#f0c87a' },
      depth2: { nodeBg: '#30200c', nodeBorder: '#bc6e2e', nodeText: '#e8b868' },
      depth3: { nodeBg: '#261a08', nodeBorder: '#a45a24', nodeText: '#e0a858' },
    },
  ],
}

export const SCHEME_PALETTES: Record<ColorSchemeId, SchemePalette> = {
  default: DEFAULT_GRAY,
  rainbow: RAINBOW,
  warm: WARM,
  ocean: OCEAN,
  forest: FOREST,
  sunset: SUNSET,
  night: NIGHT,
}

/**
 * 根据配色方案、分支索引和深度，返回节点着色参数。
 * - depth=0: 根节点，使用 root 样式
 * - depth≥1: 从 branches 中按 branchIndex % 6 取对应分支，再按深度取颜色
 */
export function getNodeColor(
  scheme: ColorSchemeId,
  depth: number,
  branchIndex: number,
): { nodeBg: string; nodeBorder: string; nodeText: string } {
  const palette = SCHEME_PALETTES[scheme]
  if (depth === 0) return palette.root

  const branch = palette.branches[branchIndex % palette.branches.length]!
  if (depth === 1) return branch.depth1
  if (depth === 2) return branch.depth2
  return branch.depth3
}

/**
 * 返回边的描边颜色：与节点边框同色。深度指边的起点（source节点）所在深度。
 */
export function getEdgeColor(scheme: ColorSchemeId, depth: number, branchIndex: number): string {
  return getNodeColor(scheme, depth, branchIndex).nodeBorder
}
