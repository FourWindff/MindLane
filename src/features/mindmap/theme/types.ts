/**
 * 导图样式由两条独立轴构成：
 *   structureType（结构）：logic 逻辑图 | mindmap 思维导图 —— 只影响布局算法
 *   visualVariant（视觉）：card 卡片 | outline 线框 | minimal 极简 —— 只影响节点/边/间距
 *
 * 配色方案 colorScheme 与两者正交。
 *
 * 持久化形状（structureType/visualVariant/colorScheme）住在契约层，与文件格式
 * 同一份定义；本模块只保留界面描述符。
 */
import type { ColorSchemeId, StructureType, VisualVariant } from '@contracts/mindmapStyle'

export type {
  ColorSchemeId,
  MindmapStyleState,
  StructureType,
  VisualVariant,
} from '@contracts/mindmapStyle'

/** 边路径算法 */
type EdgePathKind = 'bezier' | 'smooth-step' | 'step'
/** trunk=树干渐变填充（卡片式）；line=普通描边 */
type EdgeStrokeKind = 'trunk' | 'line'
/** 边连接节点的位置：side=侧边中点；bottom=节点下边框 */
export type ConnectPosition = 'side' | 'bottom'

/** 某个视觉变体的边配置 */
interface EdgeModeConfig {
  path: EdgePathKind
  stroke: EdgeStrokeKind
  connect: ConnectPosition
  /** line 模式的描边宽度；trunk 模式不使用 */
  strokeWidth: number
}

export interface StructureTypeDef {
  id: StructureType
  label: string
  description: string
}

export interface VisualVariantDef {
  id: VisualVariant
  label: string
  description: string
  edge: EdgeModeConfig
}

export interface ColorSchemeDef {
  id: ColorSchemeId
  label: string
  /** 在选色器中显示的代表色 */
}
