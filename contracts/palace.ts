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
      /**
       * Optional palace artwork, as a single image data URL (CONTEXT.md "palace
       * artwork"): landing materializes it into one image asset. Absent = a
       * palace without artwork, which is a successful run.
       */
      imageUrl?: string
      sourceNodeIds: string[]
    }
  | { ok: false; error: string }
