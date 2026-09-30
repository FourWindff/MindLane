/**
 * Palace payload shapes shared by both processes. They cross the IPC boundary
 * (a run's `end` event) and are part of the persisted palace node data.
 */

export interface PalaceStationPayload {
  order: number
  content: string
  anchorVisual: string
  association?: string
  x: number
  y: number
  linkedNodeId: string
}

export type PalaceRunPayload =
  | {
      ok: true
      label: string
      stations: PalaceStationPayload[]
      imageUrl: string
      sourceNodeIds: string[]
    }
  | { ok: false; error: string }
