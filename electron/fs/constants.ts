import path from 'node:path'

/** Extension of the app's own document format, with the leading dot. */
export const MINDLANE_EXTENSION = '.mindlane'

/** True when `filePath` points at a MindLane document. */
export function isMindLaneFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === MINDLANE_EXTENSION
}
