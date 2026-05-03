import { create } from 'zustand'
import { PalaceNodeData } from '../nodes/palace'

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
