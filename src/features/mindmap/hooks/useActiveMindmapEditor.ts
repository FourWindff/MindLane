import { useActiveMindmapInstance } from './useActiveMindmapInstance'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'

export function useActiveMindmapEditor(): MindmapEditor {
  return useActiveMindmapInstance().editor
}
