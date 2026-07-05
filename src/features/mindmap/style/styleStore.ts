import { create } from 'zustand'
import type { ColorSchemeId, MapStyleId, MindmapStyleState } from './types'

interface StyleActions {
  setMapStyle: (id: MapStyleId) => void
  setColorScheme: (id: ColorSchemeId) => void
}

type StyleStore = MindmapStyleState & StyleActions

const DEFAULT_STATE: MindmapStyleState = {
  mapStyle: 'logic-card',
  colorScheme: 'warm',
}

function persistToBackend(partial: Partial<MindmapStyleState>) {
  window.mindlane?.settings.update({ mindmapStyle: partial }).catch(() => {})
}

export const useStyleStore = create<StyleStore>((set) => ({
  ...DEFAULT_STATE,

  setMapStyle(id) {
    set({ mapStyle: id })
    persistToBackend({ mapStyle: id })
  },

  setColorScheme(id) {
    set({ colorScheme: id })
    persistToBackend({ colorScheme: id })
  },
}))

/** 从后端加载样式设置并同步到 store，在 app 初始化时调用 */
export async function loadMindmapStyleFromBackend(): Promise<void> {
  try {
    const raw = await window.mindlane?.settings.load()
    const saved = (raw as Record<string, unknown> | undefined)?.mindmapStyle as
      Partial<MindmapStyleState> | undefined
    if (!saved) return

    useStyleStore.setState({
      mapStyle: saved.mapStyle ?? DEFAULT_STATE.mapStyle,
      colorScheme: saved.colorScheme ?? DEFAULT_STATE.colorScheme,
    })
  } catch {
    // 静默失败，使用默认值
  }
}
