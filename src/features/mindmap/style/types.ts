/**
 * 导图风格 ID = 结构类型 + 视觉样式的组合：
 *   logic-*   : 逻辑图，所有节点从根向右单向展开
 *   mindmap-* : 思维导图，根节点居中，子节点向左右两侧交替展开
 *
 * 视觉变体（-card / -outline / -minimal）控制节点形状和边线类型。
 */
export type MapStyleId =
  | 'logic-card'
  | 'logic-outline'
  | 'logic-minimal'
  | 'mindmap-card'
  | 'mindmap-outline'
  | 'mindmap-minimal'

/** 从 MapStyleId 中提取结构类型 */
export function getStructureType(id: MapStyleId): 'logic' | 'mindmap' {
  return id.startsWith('mindmap') ? 'mindmap' : 'logic'
}

/** 从 MapStyleId 中提取视觉变体 */
export function getVisualVariant(id: MapStyleId): 'card' | 'outline' | 'minimal' {
  return id.split('-')[1] as 'card' | 'outline' | 'minimal'
}

/** 配色方案 */
export type ColorSchemeId = 'warm' | 'ocean' | 'forest' | 'sunset' | 'night'

export interface MapStyleDef {
  id: MapStyleId
  label: string
  description: string
  structureType: 'logic' | 'mindmap'
  visualVariant: 'card' | 'outline' | 'minimal'
  edgeVariant: 'bezier' | 'smooth-step' | 'step'
}

export interface ColorSchemeDef {
  id: ColorSchemeId
  label: string
  /** 在选色器中显示的代表色 */
  swatch: string
}

export interface MindmapStyleState {
  mapStyle: MapStyleId
  colorScheme: ColorSchemeId
}
