import fs from 'node:fs'
import path from 'node:path'

/**
 * Atomically write content to a file by writing to a temp file then renaming.
 * This ensures readers never see a partially-written file.
 */
export async function atomicWrite(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath)
  await fs.promises.mkdir(dir, { recursive: true })
  const tmpPath = targetPath + '.tmp.' + Date.now()
  await fs.promises.writeFile(tmpPath, content, 'utf-8')
  await fs.promises.rename(tmpPath, targetPath)
}
