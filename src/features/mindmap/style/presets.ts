import type { ColorSchemeDef, MapStyleDef } from './types'

export const MAP_STYLES: MapStyleDef[] = [
  // ── 逻辑图 ──────────────────────────────────────────────────────
  {
    id: 'logic-card',
    label: '卡片式',
    description: '圆角卡片节点，贝塞尔曲线',
    structureType: 'logic',
    visualVariant: 'card',
    edgeVariant: 'bezier',
  },
  {
    id: 'logic-outline',
    label: '线框式',
    description: '轻量边框节点，平滑折线',
    structureType: 'logic',
    visualVariant: 'outline',
    edgeVariant: 'smooth-step',
  },
  {
    id: 'logic-minimal',
    label: '极简式',
    description: '纯文字下划线，直角分支线',
    structureType: 'logic',
    visualVariant: 'minimal',
    edgeVariant: 'step',
  },
  // ── 思维导图 ─────────────────────────────────────────────────────
  {
    id: 'mindmap-card',
    label: '卡片式',
    description: '圆角卡片节点，贝塞尔曲线',
    structureType: 'mindmap',
    visualVariant: 'card',
    edgeVariant: 'bezier',
  },
  {
    id: 'mindmap-outline',
    label: '线框式',
    description: '轻量边框节点，平滑折线',
    structureType: 'mindmap',
    visualVariant: 'outline',
    edgeVariant: 'smooth-step',
  },
  {
    id: 'mindmap-minimal',
    label: '极简式',
    description: '纯文字下划线，直角分支线',
    structureType: 'mindmap',
    visualVariant: 'minimal',
    edgeVariant: 'step',
  },
]

export const COLOR_SCHEMES: ColorSchemeDef[] = [
  { id: 'warm', label: '暖石', swatch: '#f5f4f2' },
  { id: 'ocean', label: '海蓝', swatch: '#e8f4fd' },
  { id: 'forest', label: '森绿', swatch: '#edf5ed' },
  { id: 'sunset', label: '暮橙', swatch: '#fdf3ea' },
  { id: 'night', label: '暗夜', swatch: '#1e1e2e' },
]
