import { create } from 'zustand'
import type { ColorSchemeId, MindmapStyleState, StructureType, VisualVariant } from './types'

interface StyleActions {
  setStructureType: (type: StructureType) => void
  setVisualVariant: (variant: VisualVariant) => void
  setColorScheme: (id: ColorSchemeId) => void
}

type StyleStore = MindmapStyleState & StyleActions

const DEFAULT_STATE: MindmapStyleState = {
  structureType: 'logic',
  visualVariant: 'card',
  colorScheme: 'warm',
}

/** 旧版持久化数据：mapStyle 为 'mindmap-card' 之类的复合 id */
interface LegacyMindmapStyle {
  mapStyle?: string
  structureType?: StructureType
  visualVariant?: VisualVariant
  colorScheme?: ColorSchemeId
}

function structureFromLegacy(mapStyle?: string): StructureType | undefined {
  if (!mapStyle) return undefined
  return mapStyle.startsWith('mindmap') ? 'mindmap' : 'logic'
}

function variantFromLegacy(mapStyle?: string): VisualVariant | undefined {
  if (!mapStyle) return undefined
  const v = mapStyle.split('-')[1]
  return v === 'outline' || v === 'minimal' ? v : 'card'
}

function persistToBackend(partial: Partial<MindmapStyleState>) {
  window.mindlane?.settings.update({ mindmapStyle: partial }).catch(() => {})
}

export const useStyleStore = create<StyleStore>((set) => ({
  ...DEFAULT_STATE,

  setStructureType(structureType) {
    set({ structureType })
    persistToBackend({ structureType })
  },

  setVisualVariant(visualVariant) {
    set({ visualVariant })
    persistToBackend({ visualVariant })
  },

  setColorScheme(colorScheme) {
    set({ colorScheme })
    persistToBackend({ colorScheme })
  },
}))

/** 从后端加载样式设置并同步到 store，在 app 初始化时调用 */
export async function loadMindmapStyleFromBackend(): Promise<void> {
  try {
    const raw = await window.mindlane?.settings.load()
    const saved = (raw?.mindmapStyle ?? {}) as LegacyMindmapStyle
    useStyleStore.setState({
      structureType:
        saved.structureType ?? structureFromLegacy(saved.mapStyle) ?? DEFAULT_STATE.structureType,
      visualVariant:
        saved.visualVariant ?? variantFromLegacy(saved.mapStyle) ?? DEFAULT_STATE.visualVariant,
      colorScheme: saved.colorScheme ?? DEFAULT_STATE.colorScheme,
    })
  } catch {
    // 静默失败，使用默认值
  }
}
