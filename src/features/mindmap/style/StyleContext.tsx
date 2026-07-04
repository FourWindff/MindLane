import { useMemo, type ReactNode } from 'react'
import { useStyleStore } from './styleStore'
import { MAP_STYLES } from './presets'
import { getStructureType, getVisualVariant } from './types'
import { StyleContext, type StyleContextValue } from './useMapStyle'

/**
 * StyleProvider — 包裹整个 mindmap 画布区域。
 *
 * 通过 React Context 向子组件（节点、边）暴露当前样式配置，
 * 同时将 data-map-style 和 data-color-scheme 注入到容器 div，
 * 供 CSS 选择器实现无 JS 的视觉风格覆写（仅作用于画布内部）。
 */
export function StyleProvider({ children }: { children: ReactNode }) {
  const mapStyle    = useStyleStore((s) => s.mapStyle)
  const colorScheme = useStyleStore((s) => s.colorScheme)

  const structureType = useMemo(() => getStructureType(mapStyle), [mapStyle])
  const visualVariant = useMemo(() => getVisualVariant(mapStyle), [mapStyle])

  const edgeVariant = useMemo(
    () => MAP_STYLES.find((s) => s.id === mapStyle)?.edgeVariant ?? 'bezier',
    [mapStyle],
  )

  const ctx = useMemo<StyleContextValue>(
    () => ({ mapStyle, colorScheme, structureType, visualVariant, edgeVariant }),
    [mapStyle, colorScheme, structureType, visualVariant, edgeVariant],
  )

  return (
    <StyleContext.Provider value={ctx}>
      <div
        className="mindmap-style-root"
        data-map-style={visualVariant}
        data-color-scheme={colorScheme}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
    </StyleContext.Provider>
  )
}
