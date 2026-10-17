import fs from 'node:fs'
import path from 'node:path'

let tmpCounter = 0

/**
 * Atomically write content to a file by writing to a temp file then renaming.
 * This ensures readers never see a partially-written file.
 */
export async function atomicWrite(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath)
  await fs.promises.mkdir(dir, { recursive: true })
  // A counter keeps two writes to the same target in the same millisecond apart,
  // and the pid keeps separate processes (dev app + packaged app) apart.
  const tmpPath = `${targetPath}.tmp.${process.pid}-${tmpCounter++}`
  try {
    await fs.promises.writeFile(tmpPath, content, 'utf-8')
    await fs.promises.rename(tmpPath, targetPath)
  } catch (error) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}
