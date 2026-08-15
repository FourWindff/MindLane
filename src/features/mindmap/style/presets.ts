import type { ColorSchemeDef, StructureTypeDef, VisualVariant, VisualVariantDef } from './types'

/** 结构轴：只决定布局算法 */
export const STRUCTURE_TYPES: StructureTypeDef[] = [
  {
    id: 'logic',
    label: '逻辑图',
    description: '所有节点从根向右单向展开',
  },
  {
    id: 'mindmap',
    label: '思维导图',
    description: '根节点居中，子节点向左右两侧交替展开',
  },
]

/** 视觉轴：决定节点样式、边样式与连接方式、布局间距 */
export const VISUAL_VARIANTS: Record<VisualVariant, VisualVariantDef> = {
  card: {
    id: 'card',
    label: '卡片式',
    description: '圆角卡片节点，贝塞尔树干渐变边',
    edge: { path: 'bezier', stroke: 'trunk', connect: 'side', strokeWidth: 1.5 },
    spacing: { offsetX: 200, gapY: 12 },
  },
  outline: {
    id: 'outline',
    label: '线框式',
    description: '轻量边框节点，平滑折线',
    edge: { path: 'smooth-step', stroke: 'line', connect: 'side', strokeWidth: 1.5 },
    spacing: { offsetX: 200, gapY: 12 },
  },
  minimal: {
    id: 'minimal',
    label: '极简式',
    description: '纯文字下划线，直角分支线连接节点下边框',
    edge: { path: 'step', stroke: 'line', connect: 'bottom', strokeWidth: 2 },
    spacing: { offsetX: 200, gapY: 12 },
  },
}

export const COLOR_SCHEMES: ColorSchemeDef[] = [
  { id: 'default', label: '默认', swatch: '#9ca3af' },
  { id: 'rainbow', label: '彩虹', swatch: '#f87171' },
  { id: 'warm', label: '暖石', swatch: '#f5f4f2' },
  { id: 'ocean', label: '海蓝', swatch: '#e8f4fd' },
  { id: 'forest', label: '森绿', swatch: '#edf5ed' },
  { id: 'sunset', label: '暮橙', swatch: '#fdf3ea' },
  { id: 'night', label: '暗夜', swatch: '#1e1e2e' },
]

/** 取某视觉变体的完整配置 */
export function getVisualVariantDef(variant: VisualVariant): VisualVariantDef {
  return VISUAL_VARIANTS[variant]
}
