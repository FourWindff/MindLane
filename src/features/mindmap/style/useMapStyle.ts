import { createContext, useContext } from 'react'
import type { ColorSchemeId, MapStyleId } from './types'

export interface StyleContextValue {
  mapStyle: MapStyleId
  colorScheme: ColorSchemeId
  /** 'logic' | 'mindmap' — 决定布局算法 */
  structureType: 'logic' | 'mindmap'
  /** 'card' | 'outline' | 'minimal' — 决定节点/边视觉 */
  visualVariant: 'card' | 'outline' | 'minimal'
  /** 边路径算法（bezier / smooth-step / step） */
  edgeVariant: 'bezier' | 'smooth-step' | 'step'
}

export const StyleContext = createContext<StyleContextValue>({
  mapStyle: 'logic-card',
  colorScheme: 'warm',
  structureType: 'logic',
  visualVariant: 'card',
  edgeVariant: 'bezier',
})

export function useMapStyle(): StyleContextValue {
  return useContext(StyleContext)
}
