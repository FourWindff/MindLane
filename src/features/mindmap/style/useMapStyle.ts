import { createContext, useContext } from 'react'
import { VISUAL_VARIANTS } from './presets'
import type {
  ColorSchemeId,
  EdgeModeConfig,
  MindmapSpacing,
  StructureType,
  VisualVariant,
} from './types'

export interface StyleContextValue {
  /** 'logic' | 'mindmap' — 决定布局算法 */
  structureType: StructureType
  /** 'card' | 'outline' | 'minimal' — 决定节点/边视觉与间距 */
  visualVariant: VisualVariant
  colorScheme: ColorSchemeId
  /** 当前视觉变体的边配置 */
  edge: EdgeModeConfig
  /** 当前视觉变体的布局间距 */
  spacing: MindmapSpacing
}

const DEFAULT_VARIANT = VISUAL_VARIANTS.card

export const StyleContext = createContext<StyleContextValue>({
  structureType: 'logic',
  visualVariant: 'card',
  colorScheme: 'warm',
  edge: DEFAULT_VARIANT.edge,
  spacing: DEFAULT_VARIANT.spacing,
})

export function useMapStyle(): StyleContextValue {
  return useContext(StyleContext)
}
