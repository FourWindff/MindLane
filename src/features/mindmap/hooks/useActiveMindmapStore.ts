import { useActiveMindmapInstance } from './useActiveMindmapInstance'
import type { MindmapState } from '@/features/mindmap/model/mindmapStore'

export function useActiveMindmapStore<T>(selector: (state: MindmapState) => T): T {
  return useActiveMindmapInstance().store(selector)
}
