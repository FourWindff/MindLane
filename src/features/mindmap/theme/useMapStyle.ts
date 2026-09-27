import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveOpenFile'
import { VISUAL_VARIANTS } from './presets'

/**
 * Current mindmap style, read straight from the active store.
 *
 * The data-* attributes that drive the CSS variant rules are set by
 * `MindmapView`'s `.mindmap-shell` wrapper, so no React context is needed.
 */
export function useMapStyle() {
  const { structureType, visualVariant, colorScheme } = useActiveMindmapStore((s) => s.style)
  return {
    structureType,
    visualVariant,
    colorScheme,
    /** Current visual variant's edge config */
    edge: VISUAL_VARIANTS[visualVariant].edge,
  }
}
