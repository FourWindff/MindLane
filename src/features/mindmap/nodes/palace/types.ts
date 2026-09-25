import type { PalaceStationPayload } from '../../../../../electron/ipc'

export type PalaceNodeData = {
  label: string
  /** 内嵌图片资源 id（<assets> 节）；迁移期下载失败的旧文件保留 imageUrl */
  assetId?: string
  imageUrl: string
  stations: PalaceStation[]
  sourceNodeIds: string[]
  expanded?: boolean
  generating?: boolean
  /** Live manual-run stage label (transient, never persisted). */
  runStage?: string
  /** Manual run stopped or failed: the node keeps its placeholder and offers 继续. */
  runStopped?: boolean
}

/** Palace stations are the landing payload's stations — the node stores that payload. */
export type PalaceStation = PalaceStationPayload
