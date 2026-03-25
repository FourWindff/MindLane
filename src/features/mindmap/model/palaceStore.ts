import { create } from 'zustand'
import type { PalaceNodeData } from '@/shared/lib/fileFormat'

interface PalaceState {
  activePalaceId: string | null
  activePalaceData: PalaceNodeData | null

  openPalace: (nodeId: string, data: PalaceNodeData) => void
  closePalace: () => void
}

export const usePalaceStore = create<PalaceState>((set) => ({
  activePalaceId: null,
  activePalaceData: null,

  openPalace: (nodeId, data) => set({ activePalaceId: nodeId, activePalaceData: data }),
  closePalace: () => set({ activePalaceId: null, activePalaceData: null }),
}))
